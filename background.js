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
	if (!chrome.contextMenus) {
		logToPopup('ContextMenus API unavailable - skipping initialization', 'warn');
		return;
	}

	try {
		chrome.contextMenus.remove('translateWithAI', () => {
			if (chrome.runtime.lastError) {
				logToPopup(`Context menu remove failed: ${chrome.runtime.lastError.message}`, 'warn');
			}
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

// Context menu handler
if (chrome.contextMenus) {
	// Track state per tab
	const tabStates = new Map();

	chrome.contextMenus.onClicked.addListener((info, tab) => {
		const currentTime = Date.now();
		const tabId = tab?.id;
		if (!tabId) {
			console.error('Invalid tab ID');
			logToPopup('Invalid tab ID', 'error');
			return;
		}

		// Initialize tab state if not exists
		if (!tabStates.has(tabId)) {
			tabStates.set(tabId, { lastClickTime: 0, scriptsInjected: false });
		}
		const tabState = tabStates.get(tabId);

		// Debounce clicks
		const debounceDelay = 2000; // 2 seconds
		if (currentTime - tabState.lastClickTime < debounceDelay) {
			console.log('Debounced context menu click, ignoring');
			logToPopup('Debounced context menu click, ignoring', 'warn');
			return;
		}
		tabState.lastClickTime = currentTime;

		if (info.menuItemId === 'translateWithAI' && info.selectionText && info.frameId === 0) {
			console.log('Context menu clicked - translating selection:', info.selectionText);
			logToPopup('Context menu clicked - translating selection');

			// Inject scripts only once
			const injectScripts = () => {
				if (!tabState.scriptsInjected) {
					console.log('Injecting scripts for tab:', tabId);
					tabState.scriptsInjected = true;
					return chrome.scripting.executeScript({
						target: { tabId, frameIds: [0] },
						files: ['custom-elements-polyfill.js', 'overlay.js']
					}).catch(err => {
						console.error('Overlay script injection failed:', err.message);
						logToPopup(`Overlay script injection failed: ${err.message}`, 'error');
						tabState.scriptsInjected = false;
						throw err;
					});
				}
				console.log('Scripts already injected for tab:', tabId);
				return Promise.resolve();
			};

			// Create loading overlay and handle translation
			injectScripts().then(() => {
				console.log('Creating loading overlay for tab:', tabId);

				// Create loading overlay
				chrome.scripting.executeScript({
					target: { tabId, frameIds: [0] },
					func: (original) => {
						console.log('Creating loading overlay with text:', original);
						createOverlay('loading', original);
					},
					args: [info.selectionText]
				}).then(() => {
					console.log('Loading overlay created successfully');
				}).catch(err => {
					console.error('Loading overlay injection failed:', err.message);
				});

				// Handle translation with timeout
				Promise.race([
					translateText(info.selectionText, 'English', tab, 'selection'),
					new Promise((_, reject) => setTimeout(() => reject(new Error('Translation timeout after 10s')), 10000))
				]).then(result => {
					console.log('Translation succeeded, updating overlay with result');

					chrome.scripting.executeScript({
						target: { tabId, frameIds: [0] },
						func: (original, translation) => {
							console.log('Updating overlay with translation result');
							createOverlay('translation', original, translation);
						},
						args: [info.selectionText, result]
					}).then(() => {
						console.log('Overlay updated with translation successfully');
					}).catch(err => {
						console.error('Overlay update failed:', err.message);
					});
				}).catch(error => {
					console.error('Translation failed, updating overlay with error');

					chrome.scripting.executeScript({
						target: { tabId, frameIds: [0] },
						func: (original, errorMessage) => {
							console.log('Updating overlay with error');
							createOverlay('error', original, errorMessage);
						},
						args: [info.selectionText, error.message]
					}).then(() => {
						console.log('Overlay updated with error successfully');
					}).catch(err => {
						console.error('Error overlay update failed:', err.message);
					});
				});
			}).catch(err => {
				console.error('Script injection failed:', err.message);
			});
		} else {
			console.log('Invalid context menu call - missing selection, tab, or not in top-level frame');
			logToPopup('Invalid context menu call - missing selection, tab, or not in top-level frame', 'warn');
		}
	});

	// Clean up tab state on tab close
	chrome.tabs.onRemoved.addListener((tabId) => {
		console.log('Cleaning up tab state for tab:', tabId);
		tabStates.delete(tabId);
	});
}

// Simplified translateText
async function translateText(text, targetLang = 'English', tab = null, source = null) {
	try {
		logToPopup(`Translating to ${targetLang}: ${text.substring(0, 100)}...`);
		const { apiKey } = await chrome.storage.sync.get(['apiKey']);
		if (!apiKey) throw new Error('Please set your Gemini API key');

		const translation = await translateWithGemini(text, targetLang, apiKey);
		const result = String(translation || 'Translation unavailable');

		// For popup translations, store the result
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
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 8000); // 8s timeout per model

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
			}),
			signal: controller.signal
		});

		clearTimeout(timeoutId);

		if (!response.ok) {
			const errorText = await response.text();
			let errorObj;
			try {
				errorObj = JSON.parse(errorText);
				if (errorObj.error?.status === 'RESOURCE_EXHAUSTED') {
					logToPopup(`Quota exceeded on ${model}: ${errorObj.error?.message || 'Rate limit'}`, 'error');
					return await translateWithGemini(text, targetLang, apiKey, modelIndex + 1);
				}
				throw new Error(`API error: ${errorObj.error?.message || errorText}`);
			} catch (e) {
				throw new Error(`HTTP ${response.status} (${model}): ${errorText}`);
			}
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
		if (error.name === 'AbortError') {
			logToPopup(`${model} timed out, trying next model...`, 'warn');
			return await translateWithGemini(text, targetLang, apiKey, modelIndex + 1);
		}
		if (error.message.includes('RESOURCE_EXHAUSTED') || error.message.includes('Quota exceeded')) {
			logToPopup(`Quota exceeded on ${model}, trying next model...`, 'warn');
			return await translateWithGemini(text, targetLang, apiKey, modelIndex + 1);
		}
		throw error;
	}
}
