// Simplified background script - popup-only
console.log('AI Translator (Gemini 2.5 Flash) loaded');

const MODELS = [
	'gemini-2.5-flash',                    // Primary - best quality
	'gemini-2.5-flash-lite-preview-09-2025', // Lighter Flash variant
	'gemini-1.5-flash',                    // Previous stable Flash
	'gemini-pro'                           // Emergency - most reliable
];

chrome.runtime.onInstalled.addListener(() => {
	chrome.contextMenus.create({
		id: "translateWithAI",
		title: "Translate with Gemini AI",
		contexts: ["selection"]
	});
});

// Keep context menu for selection (uses overlay)
chrome.contextMenus.onClicked.addListener((info, tab) => {
	if (info.menuItemId === "translateWithAI" && info.selectionText) {
		translateText(info.selectionText, tab, 'selection'); // Keep for context menu
	}
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
	if (request.action === 'translateText') {
		// Popup translation - no tab/source needed
		translateText(request.text, request.targetLang)
			.then(result => {
				sendResponse({ result: String(result) });
			})
			.catch(originalError => {
				console.error('🔥 Background error:', originalError);
				sendResponse({
					error: originalError.message,
					stack: originalError.stack
				});
			});
		return true;
	}
});


async function translateWithGemini(text, targetLang, apiKey, modelIndex = 0) {
	// Validate index
	if (modelIndex >= MODELS.length) {
		throw new Error('All models exhausted. Check quotas or try later.');
	}

	const model = MODELS[modelIndex];
	console.log(`🌐 Trying ${model} (${modelIndex + 1}/${MODELS.length})...`);

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
				const status = errorObj.error?.status;

				// Quota errors stop the chain
				if (status === 'RESOURCE_EXHAUSTED') {
					throw new Error(`Quota exceeded on ${model}: ${errorObj.error?.message || 'Rate limit'}`);
				}
			} catch (e) { }

			throw new Error(`HTTP ${response.status} (${model})`);
		}

		const data = await response.json();
		const candidate = data.candidates?.[0];

		// Check for failure conditions
		const isFailure = candidate?.finishReason === 'MAX_TOKENS' ||
			!candidate?.content?.parts?.[0]?.text;

		if (isFailure) {
			console.warn(`❌ ${model} failed (${candidate?.finishReason || 'empty'}). Trying next...`);
			// Recurse with next model
			return await translateWithGemini(text, targetLang, apiKey, modelIndex + 1);
		}

		// Success! Clean the output
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

		// Take first substantial paragraph if multiple
		const paragraphs = translation.split('\n\n').filter(p => p.trim().length > 10);
		if (paragraphs.length > 1) translation = paragraphs[0];

		console.log(`✅ ${model} SUCCESS (${modelIndex + 1}/${MODELS.length}):`, translation.substring(0, 100));
		return translation;

	} catch (error) {
		console.error(`💥 ${model} error:`, error.message);

		// Quota errors stop chain, others continue
		if (error.message.includes('RESOURCE_EXHAUSTED') || error.message.includes('Quota exceeded')) {
			throw new Error(`Free tier quota exceeded on ${model}. Check aistudio.google.com`);
		}

		// Try next model for other errors
		return await translateWithGemini(text, targetLang, apiKey, modelIndex + 1);
	}
}

// Enhanced translateText with fallback logic
async function translateText(text, targetLang = 'English', tab = null, source = null) {
	try {
		console.log(`Translating to ${targetLang}:`, text.substring(0, 100) + '...');

		const { apiKey } = await chrome.storage.sync.get(['apiKey']);
		if (!apiKey) {
			throw new Error('Please set your Gemini API key');
		}

		// Try primary model with automatic fallback
		const translation = await translateWithGemini(text, targetLang, apiKey);

		const result = String(translation || 'Translation unavailable');

		// Overlay for context menu only
		if (source === 'selection' && tab && chrome.scripting) {
			try {
				await chrome.scripting.executeScript({
					target: { tabId: tab.id },
					func: showTranslationOverlay,
					args: [text, result]
				});
			} catch (overlayError) {
				console.warn('Overlay failed:', overlayError);
			}
		}

		// Save successful result (popup only)
		if (source !== 'selection') {
			chrome.storage.sync.set({
				lastResult: result,
				lastTargetLang: targetLang
			});
		}

		return result;

	} catch (error) {
		console.error('Translation failed:', error.message);

		// Specific quota messaging
		if (error.message.includes('RESOURCE_EXHAUSTED') || error.message.includes('Quota exceeded')) {
			throw new Error('Free tier quota exceeded. Check aistudio.google.com or wait for reset.');
		}

		throw error; // Preserve original
	}
}

// Keep overlay function for context menu (unchanged)
function showTranslationOverlay(original, translation) {
	if (!translation || typeof translation !== 'string') return;

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
