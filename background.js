// background.js
const MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite-preview-09-2025',
  'gemini-1.5-flash',
  'gemini-pro'
];

// Log forwarding helper
function logToPopup(message, level = 'log') {
  chrome.runtime.sendMessage({
    action: 'debugLog',
    message: `[BG] ${message}`,
    level
  }).catch(err => {
    if (!err.message.includes('Receiving end does not exist')) {
      console.error('Log forwarding error:', err);
    }
  });
}

logToPopup('🔥 Background script loaded');

// Initialize context menu with safety checks
function initializeContextMenu() {
  // Check if contextMenus API is available
  if (!chrome.contextMenus) {
    logToPopup('ContextMenus API unavailable - skipping initialization', 'warn');
    return;
  }

  try {
    // Remove existing menu to avoid duplicates
    chrome.contextMenus.remove('translateWithAI', () => {
      if (chrome.runtime.lastError) {
        logToPopup(`Context menu remove failed: ${chrome.runtime.lastError.message}`, 'warn');
      }
      // Create new menu
      chrome.contextMenus.create({
        id: "translateWithAI",
        title: "Translate with AI Translator",
        contexts: ["selection"]
      }, () => {
        if (chrome.runtime.lastError) {
          logToPopup(`Context menu creation failed: ${chrome.runtime.lastError.message}`, 'error');
        } else {
          logToPopup('Context menu initialized successfully');
        }
      });
    });
  } catch (error) {
    logToPopup(`Context menu setup error: ${error.message}`, 'error');
  }
}

// Lifecycle events
chrome.runtime.onInstalled.addListener(() => {
  logToPopup('Extension installed');
  initializeContextMenu();
});

chrome.runtime.onStartup.addListener(() => {
  logToPopup('Chrome started - background active');
  initializeContextMenu();
});

// Message handler
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  logToPopup(`Message received: ${request.action}`);
  
  if (request.action === 'wake') {
    logToPopup('Background woken by popup');
    sendResponse({ status: 'awake' });
    return true;
  }
  
  if (request.action === 'translateText') {
    translateText(request.text, request.targetLang)
      .then(result => sendResponse({ result: String(result) }))
      .catch(error => sendResponse({ error: error.message, stack: error.stack }));
    return true;
  }
});

// Context menu handler with maximum error isolation
if (chrome.contextMenus) {
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === 'translateWithAI' && info.selectionText && tab?.id) {
      logToPopup('Context menu clicked - translating selection');
      // Full async error boundary
      Promise.resolve().then(async () => {
        try {
          const result = await translateText(info.selectionText, 'English', tab, 'selection');
          logToPopup('Context menu translation succeeded');
        } catch (error) {
          logToPopup(`Context menu translation failed: ${error.message}`, 'error');
          if (tab?.id && chrome.scripting) {
            try {
              await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: showErrorOverlay,
                args: [info.selectionText, error.message]
              });
            } catch (scriptError) {
              logToPopup(`Overlay error: ${scriptError.message}`, 'error');
            }
          }
        }
      }).catch(err => {
        logToPopup(`Unexpected context menu error: ${err.message}`, 'error');
      });
    } else {
      logToPopup('Invalid context menu call - missing selection or tab', 'warn');
    }
  });
} else {
  logToPopup('ContextMenus API not available - skipping listener', 'warn');
}

// Simplified translateText
async function translateText(text, targetLang = 'English', tab = null, source = null) {
  try {
    logToPopup(`Translating to ${targetLang}: ${text.substring(0, 100)}...`);
    const { apiKey } = await chrome.storage.sync.get(['apiKey']);
    if (!apiKey) throw new Error('Please set your Gemini API key');
    
    const translation = await translateWithGemini(text, targetLang, apiKey);
    const result = String(translation || 'Translation unavailable');
    
    if (source === 'selection' && tab?.id && chrome.scripting) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: showTranslationOverlay,
          args: [text, result]
        });
      } catch (scriptError) {
        logToPopup(`Overlay injection failed: ${scriptError.message}`, 'error');
      }
    }
    
    if (source !== 'selection') {
      chrome.storage.sync.set({ 
        lastResult: result,
        lastTargetLang: targetLang 
      });
    }
    
    return result;
  } catch (error) {
    logToPopup(`Translation failed: ${error.message}`, 'error');
    throw error;
  }
}

async function translateWithGemini(text, targetLang, apiKey, modelIndex = 0) {
  if (modelIndex >= MODELS.length) {
    logToPopup('All models exhausted', 'error');
    throw new Error('All models exhausted. Check quotas or try later.');
  }
  
  const model = MODELS[modelIndex];
  logToPopup(`Trying ${model} (${modelIndex + 1}/${MODELS.length})...`);
  
  const prompt = `Translate ONLY to ${targetLang}. Respond with JUST the translation:

${text}

RULES:
- Single paragraph only
- No explanations, no options, no formatting
- Plain text only`;

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: model.includes('pro') ? 150 : 300,
          topP: 0.1,
          topK: 1
        },
        safetySettings: []
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      let errorObj;
      try {
        errorObj = JSON.parse(errorText);
        if (errorObj.error?.status === 'RESOURCE_EXHAUSTED') {
          throw new Error(`Quota exceeded on ${model}: ${errorObj.error?.message || 'Rate limit'}`);
        }
      } catch (e) {}
      throw new Error(`HTTP ${response.status} (${model})`);
    }
    
    const data = await response.json();
    const candidate = data.candidates?.[0];
    
    if (candidate?.finishReason === 'MAX_TOKENS' || !candidate?.content?.parts?.[0]?.text) {
      logToPopup(`${model} failed (${candidate?.finishReason || 'empty'}). Trying next...`, 'warn');
      return await translateWithGemini(text, targetLang, apiKey, modelIndex + 1);
    }
    
    let translation = candidate.content.parts[0].text.trim();
    translation = translation
      .replace(/^```[\s\S]*?```/gs, '')
      .replace(/^\*\*([^**]+)\*\*/g, '$1')
      .replace(/^>?\s*/gm, '')
      .replace(/Option \d*:?/gi, '')
      .replace(/^\d+\.\s*/gm, '')
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/\*(.+?)\*/g, '$1')
      .replace(/\(.*?\)/g, '')
      .replace(/\[.*?\]/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/^(Here are|Here is|Translation:)/i, '')
      .trim();
    
    const paragraphs = translation.split('\n\n').filter(p => p.trim().length > 10);
    if (paragraphs.length > 1) translation = paragraphs[0];
    
    logToPopup(`${model} SUCCESS (${modelIndex + 1}/${MODELS.length}): ${translation.substring(0, 100)}`);
    return translation;
  } catch (error) {
    logToPopup(`${model} error: ${error.message}`, 'error');
    if (error.message.includes('RESOURCE_EXHAUSTED') || error.message.includes('Quota exceeded')) {
      throw new Error(`Free tier quota exceeded on ${model}. Check aistudio.google.com`);
    }
    return await translateWithGemini(text, targetLang, apiKey, modelIndex + 1);
  }
}

// Error overlay for context menu failures
function showErrorOverlay(original, errorMessage) {
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
    background: white; border: 2px solid #dc3545; border-radius: 8px;
    padding: 20px; max-width: 90vw; z-index: 100000;
    font-family: Arial, sans-serif;
  `;
  overlay.innerHTML = `
    <div style="display: flex; justify-content: space-between; margin-bottom: 15px;">
      <h4>Translation Error</h4>
      <button onclick="this.parentElement.parentElement.remove()" 
              style="background: #dc3545; color: white; border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer;">
        ✕
      </button>
    </div>
    <div style="color: #721c24;">${errorMessage}</div>
  `;
  document.body.appendChild(overlay);
}

// Translation overlay
function showTranslationOverlay(original, translation) {
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
    background: white; border: 2px solid #4285f4; border-radius: 8px;
    padding: 20px; max-width: 90vw; max-height: 80vh; overflow-y: auto;
    z-index: 100000; box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    font-family: Arial, sans-serif;
  `;
  overlay.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
      <h4>Gemini Translation</h4>
      <button onclick="this.parentElement.parentElement.remove()" 
              style="background: #dc3545; color: white; border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer;">
        ✕
      </button>
    </div>
    <div style="margin-bottom: 10px;">
      <strong>Original:</strong><br><span style="background: #f8f9fa; padding: 5px;">${original}</span>
    </div>
    <div style="background: #e8f4fd; padding: 10px; border-radius: 4px;">
      <strong>Translated:</strong><br>${translation}
    </div>
  `;
  document.body.appendChild(overlay);
}