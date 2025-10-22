// Multiple initialization strategies for Chrome popup
console.log('popup.js loaded');

if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', initializePopup);
	console.log('Waiting for DOMContentLoaded...');
} else {
	console.log('DOM already loaded, initializing immediately');
	initializePopup();
}

setTimeout(() => {
	if (!window.popupInitialized) {
		console.log('Fallback: Initializing via timeout');
		initializePopup();
	}
}, 100);

// popup.js
function initializePopup() {
	if (window.popupInitialized) {
		console.log('Popup already initialized, skipping');
		return;
	}

	window.popupInitialized = true;
	console.log('🟢 popup.js INITIALIZED');

	// Wake background immediately
	chrome.runtime.sendMessage({ action: 'wake' }, (response) => {
		if (chrome.runtime.lastError) {
			console.error('❌ Background wake failed:', chrome.runtime.lastError.message);
			showError('Extension error: Background not responding. Reload extension.');
		} else {
			console.log('✅ Background awake:', response);
		}
	});

	const apiKeyInput = document.getElementById('apiKey');
	const apiKeyGroup = document.getElementById('apiKeyGroup');
	const apiKeyToggle = document.getElementById('apiKeyToggle');
	const targetLangSelect = document.getElementById('targetLang');
	const inputText = document.getElementById('inputText');
	const translateBtn = document.getElementById('translateBtn');
	const translationResult = document.getElementById('translationResult');
	const translatedText = document.getElementById('translatedText');
	const statusDiv = document.getElementById('status');
	let currentError = null;

	if (!apiKeyInput || !apiKeyGroup || !apiKeyToggle || !targetLangSelect || !inputText || !translateBtn) {
		console.error('❌ Missing DOM elements');
		return;
	}

	console.log('✅ All DOM elements found');

	// Toggle API key input visibility
	function toggleApiKeyInput(hasKey) {
		if (hasKey) {
			apiKeyGroup.classList.add('hidden');
			apiKeyToggle.classList.add('visible');
		} else {
			apiKeyGroup.classList.remove('hidden');
			apiKeyToggle.classList.remove('visible');
		}
	}

	// Load saved data
	chrome.storage.sync.get([
		'apiKey', 'targetLang', 'lastInput', 'lastResult'
	], (result) => {
		console.log('Storage loaded:', Object.keys(result));

		if (result.apiKey) {
			apiKeyInput.value = result.apiKey;
			toggleApiKeyInput(true);
		} else {
			toggleApiKeyInput(false);
		}
		if (result.targetLang) targetLangSelect.value = result.targetLang;
		if (result.lastInput) inputText.value = result.lastInput;

		// Show last result
		if (result.lastResult) {
			console.log('Showing last result');
			translatedText.textContent = result.lastResult;
			translationResult.style.display = 'block';
		}

		autoResizeTextarea();
	});

	// Toggle API key input on gear click
	apiKeyToggle.addEventListener('click', () => {
		const isHidden = apiKeyGroup.classList.contains('hidden');
		toggleApiKeyInput(!isHidden);
		if (isHidden) {
			apiKeyInput.focus();
		}
	});

	// Save settings
	const saveSettings = () => {
		const apiKey = apiKeyInput.value.trim();
		chrome.storage.sync.set({
			apiKey: apiKey,
			targetLang: targetLangSelect.value,
			lastInput: inputText.value
		});
		toggleApiKeyInput(!!apiKey); // Update visibility based on key
	};

	apiKeyInput.onchange = saveSettings;
	targetLangSelect.onchange = saveSettings;

	inputText.oninput = () => {
		saveSettings();
		autoResizeTextarea();
		if (currentError) {
			clearError();
			currentError = null;
		}
	};

	// Shared submit handler
	async function handleSubmit() {
		const text = inputText.value.trim();
		const apiKey = apiKeyInput.value.trim();
		const targetLang = targetLangSelect.value;

		if (!text) {
			showError('Please enter text to translate');
			return;
		}
		if (!apiKey) {
			showError('Please enter your Gemini API key');
			toggleApiKeyInput(false); // Show input if key is missing
			return;
		}
		if (text.length > 4000) {
			showError('Text too long (max 4000 chars)');
			return;
		}

		saveSettings();
		chrome.storage.sync.set({ apiKey });

		translateBtn.disabled = true;
		translateBtn.textContent = 'Translating...';

		try {
			console.log('Sending translation request:', {
				text: text.substring(0, 50) + '...',
				targetLang
			});

			const translation = await new Promise((resolve, reject) => {
				chrome.runtime.sendMessage({
					action: 'translateText',
					text: text,
					targetLang: targetLang
				}, (response) => {
					console.log('📨 Background response:', response);

					if (chrome.runtime.lastError) {
						reject(new Error(chrome.runtime.lastError.message));
						return;
					}

					if (response?.error) {
						const apiError = new Error(response.error);
						apiError.stack = response.stack;
						reject(apiError);
						return;
					}

					if (response?.result) {
						resolve(String(response.result).trim());
					} else {
						reject(new Error(`Invalid response: ${JSON.stringify(response)}`));
					}
				});
			});

			console.log('✅ Translation received');
			translatedText.textContent = translation;
			translationResult.style.display = 'block';
			clearError();
			inputText.blur();

			// Save successful result
			chrome.storage.sync.set({
				lastResult: translation,
				lastTargetLang: targetLang
			});

		} catch (originalError) {
			console.error('💥 Translation error:', originalError.message);
			showError(originalError.message);
		} finally {
			translateBtn.disabled = false;
			translateBtn.textContent = 'Translate';
		}
	}

	// Translate button
	translateBtn.onclick = handleSubmit;

	// Ctrl+Enter to submit
	inputText.addEventListener('keydown', (event) => {
		if (event.ctrlKey && event.key === 'Enter') {
			event.preventDefault(); // Prevent newline in textarea
			handleSubmit();
		}
	});

	function autoResizeTextarea() {
		inputText.style.height = 'auto';
		inputText.style.height = Math.min(inputText.scrollHeight, 200) + 'px';
	}

	function showError(message) {
		currentError = message;
		statusDiv.textContent = message;
		statusDiv.className = 'error';
		statusDiv.style.display = 'block';
	}

	function clearError() {
		currentError = null;
		statusDiv.style.display = 'none';
	}

	// Handle debug logs from background
	chrome.runtime.onMessage.addListener((request) => {
		if (request.action === 'debugLog') {
			const logFunc = console[request.level] || console.log;
			logFunc(`[FORWARDED] ${request.message}`);
		}
	});

	setTimeout(() => inputText.focus(), 200);
	console.log('🟢 Popup initialization complete');
}