// overlay.js
function createOverlay(type, original, content = '') {
	// Only run in the top-level window
	if (window !== window.top) {
		console.log('Skipping createOverlay in iframe:', window.location.href);
		return;
	}

	// Check for existing overlay
	const existing = document.querySelector('gemini-translation-overlay') || document.getElementById('gemini-translation-overlay');

	if (existing) {
		// Update existing overlay instead of creating new one
		console.log('Updating existing overlay to:', type);
		updateExistingOverlay(existing, type, original, content);
		return;
	}

	console.log('Creating new overlay:', type, 'with original:', original);

	// Use Web Component for all states
	createWebComponentOverlay(type, original, content);
}

function updateExistingOverlay(existing, type, original, content) {
	// For Web Component, update attributes and let it re-render
	if (existing.tagName === 'GEMINI-TRANSLATION-OVERLAY') {
		existing.setAttribute('data-type', type);
		existing.setAttribute('data-original', original);
		if (content) {
			existing.setAttribute('data-content', content);
		} else {
			existing.removeAttribute('data-content');
		}
		console.log('Web Component attributes updated for:', type);
		return;
	}

	// Fallback for div overlay
	let borderColor = '#d4d4d4';
	let title = 'AI Translation';
	let buttonStyle = `
    background: #ececec !important; 
    color: #464646 !important; 
    border: none !important; 
    width: 30px !important;
    height: 30px !important;
    border-radius: 50% !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    font-size: 16px !important;
    line-height: 1 !important;
  `;
	let contentHtml = '';

	if (type === 'loading') {
		contentHtml = `
      <div style="margin-bottom: 10px;">
        <strong>Original:</strong><br>
        <span style="background: #f8f9fa; padding: 5px; border-radius: 4px; display: inline-block;">${original}</span>
      </div>
      <div style="display: flex; align-items: center; gap: 10px;">
        <div style="width: 20px; height: 20px; border: 2px solid #f3f3f3; border-top: 2px solid #2c7ed1; border-radius: 50%; animation: spin 1s linear infinite;"></div>
        <strong>Translating...</strong>
      </div>
    `;
	} else if (type === 'translation') {
		contentHtml = `
      <div style="margin-bottom: 10px;">
        <strong>Original:</strong><br>
        <span style="background: #f8f9fa; padding: 5px; border-radius: 4px; display: inline-block;">${original}</span>
      </div>
      <div>
        <strong>Translated:</strong><br>
        <span style="background: #f8f9fa; padding: 5px; border-radius: 4px; display: inline-block;">${content}</span>
      </div>
    `;
	} else if (type === 'error') {
		title = 'Translation Error';
		borderColor = '#dc3545';
		buttonStyle = `
      background: #dc3545 !important; 
      color: white !important; 
      border: none !important;
      width: 30px !important;
      height: 30px !important;
      border-radius: 50% !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      font-size: 16px !important;
      line-height: 1 !important;
    `;
		contentHtml = `
      <div style="color: #721c24; padding: 10px; background: #f8d7da; border-radius: 4px;">
        ${content}
      </div>
    `;
	}

	// Update the existing overlay
	existing.style.borderColor = borderColor;

	// Update title and content
	const header = existing.querySelector('h4');
	if (header) {
		header.textContent = title;
	}

	const button = existing.querySelector('button');
	if (button) {
		button.style.cssText = buttonStyle + ' cursor: pointer !important;';
	}

	// Update content area (skip the header and button)
	const contentElements = existing.querySelectorAll('div');
	let contentUpdated = false;

	for (let i = 0; i < contentElements.length; i++) {
		const element = contentElements[i];
		// Find the content div (not the header div)
		if (!element.querySelector('h4') && !element.querySelector('button')) {
			element.innerHTML = contentHtml;
			contentUpdated = true;
			break;
		}
	}

	// If we couldn't find the content area, replace the entire innerHTML
	if (!contentUpdated) {
		existing.innerHTML = `
      <div style="display: flex !important; justify-content: space-between !important; align-items: center !important; margin-bottom: 15px !important;">
        <h4 style="margin: 0 !important; font-size: 16px !important;">${title}</h4>
        <button id="close-overlay-btn" style="${buttonStyle} cursor: pointer !important;">
          ${closeIcon}
        </button>
      </div>
      ${contentHtml}
      <div class="api-info" style="margin-top: 15px; padding-top: 10px; border-top: 1px solid #eee; text-align: center; font-size: 12px; color: #666;">
        Made by <a href="https://aamu.app" target="_blank" style="color: #2c7ed1; text-decoration: none; font-weight: bold;">Aamu.app</a>
      </div>
    `;

		// Re-attach event listener
		const closeBtn = existing.querySelector('#close-overlay-btn');
		if (closeBtn) {
			closeBtn.addEventListener('click', () => {
				existing.remove();
			});
		}
	}

	console.log('Existing overlay updated to:', type);
}

function createWebComponentOverlay(type, original, content) {
	console.log('Creating Web Component overlay for:', type);

	// Define the Web Component if not already defined
	if (typeof customElements !== 'undefined' && customElements !== null && typeof customElements.get === 'function') {
		if (!customElements.get('gemini-translation-overlay')) {
			console.log('Defining Web Component: gemini-translation-overlay');

			class GeminiTranslationOverlay extends HTMLElement {
				constructor() {
					super();
					this.shadowContainer = null;
					try {
						this.shadowContainer = this.attachShadow({ mode: 'open' });
						console.log('Shadow DOM created successfully');
					} catch (error) {
						console.error('Failed to attach shadow DOM:', error);
						this.shadowContainer = this;
						console.log('Using light DOM as fallback');
					}
				}

				static get observedAttributes() {
					return ['data-type', 'data-original', 'data-content'];
				}

				attributeChangedCallback(name, oldValue, newValue) {
					console.log(`Attribute changed: ${name} from ${oldValue} to ${newValue}`);
					if (oldValue !== newValue) {
						this.render();
					}
				}

				connectedCallback() {
					console.log('Web Component connected:', this.getAttribute('data-type'));
					this.render();
				}

				// In the Web Component class, update the render method:
				render() {
					const type = this.getAttribute('data-type') || 'loading';
					const original = this.getAttribute('data-original') || '';
					const content = this.getAttribute('data-content') || '';

					console.log('Rendering Web Component with type:', type);

					let borderColor = '#d4d4d4';
					let title = 'AI Translation';
					let buttonStyles = `
    background: #ececec;
    color: #464646;
    border: none;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 16px;
    padding: 0;
    margin: 0;
    cursor: pointer;
  `;
					let contentHtml = '';

					// SVG close icon - perfectly centered
					const closeIcon = `
    <svg width="9" height="9" viewBox="0 0 14 14" fill="currentColor">
      <path d="M13 1L1 13M1 1l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>
  `;

					if (type === 'loading') {
						contentHtml = `
      <div style="margin-bottom: 10px;">
        <strong>Original:</strong><br>
        <span style="background: #f8f9fa; padding: 5px; border-radius: 4px; display: inline-block;">${original}</span>
      </div>
      <div style="display: flex; align-items: center; gap: 10px;">
        <div style="width: 20px; height: 20px; border: 2px solid #f3f3f3; border-top: 2px solid #2c7ed1; border-radius: 50%; animation: spin 1s linear infinite;"></div>
        <strong>Translating...</strong>
      </div>
    `;
					} else if (type === 'translation') {
						contentHtml = `
      <div style="margin-bottom: 10px;">
        <strong>Original:</strong><br>
        <span style="background: #f8f9fa; padding: 5px; border-radius: 4px; display: inline-block;">${original}</span>
      </div>
      <div>
        <strong>Translated:</strong><br>
        <span style="background: #f8f9fa; padding: 5px; border-radius: 4px; display: inline-block;">${content}</span>
      </div>
    `;
					} else if (type === 'error') {
						title = 'Translation Error';
						borderColor = '#dc3545';
						buttonStyles = `
      background: #dc3545;
      color: white;
      border: none;
      width: 30px;
      height: 30px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
      padding: 0;
      margin: 0;
      cursor: pointer;
    `;
						contentHtml = `
      <div style="color: #721c24; padding: 10px; background: #f8d7da; border-radius: 4px;">
        ${content}
      </div>
    `;
					}

					const styles = `
    <style>
      :host {
        position: fixed !important;
        top: 50% !important;
        left: 50% !important;
        transform: translate(-50%, -50%) !important;
        background: white !important;
        border: 2px solid ${borderColor} !important;
        border-radius: 8px !important;
        padding: 20px !important;
        max-width: 90vw !important;
        max-height: 80vh !important;
        overflow-y: auto !important;
        z-index: 2147483647 !important;
        box-shadow: 0 4px 20px rgba(0,0,0,0.3) !important;
        font-family: Arial, sans-serif !important;
        font-size: 16px !important;
        color: #000 !important;
        display: block !important;
        transition: border-color 0.2s ease-in-out;
      }
      .header {
        display: flex !important;
        justify-content: space-between !important;
        align-items: center !important;
        margin-bottom: 15px !important;
      }
      h4 {
        margin: 0 !important;
        font-size: 16px !important;
      }
      .close-btn {
        ${buttonStyles}
      }
      .close-btn:hover {
        background: ${type === 'error' ? '#c82333' : '#d4d4d4'} !important;
        transform: rotate(90deg);
        transition: all 0.3s ease;
      }
      .api-info {
        margin-top: 15px;
        padding-top: 10px;
        border-top: 1px solid #eee;
        text-align: center;
        font-size: 12px;
        color: #666;
      }
      .api-info a {
        color: #2c7ed1;
        text-decoration: none;
        font-weight: bold;
      }
      .api-info a:hover {
        text-decoration: underline;
      }
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    </style>
  `;

					const template = `
    ${styles}
    <div class="header">
      <h4>${title}</h4>
      <button class="close-btn" id="close-overlay">${closeIcon}</button>
    </div>
    ${contentHtml}
    <div class="api-info">
      Made by <a href="https://aamu.app" target="_blank">Aamu.app</a>
    </div>
  `;

					if (this.shadowContainer instanceof ShadowRoot) {
						this.shadowContainer.innerHTML = template;

						// Add event listener for shadow DOM
						const closeBtn = this.shadowContainer.getElementById('close-overlay');
						if (closeBtn) {
							closeBtn.addEventListener('click', () => {
								this.remove();
							});
						}
					} else {
						this.innerHTML = template;

						// Add event listener for light DOM
						const closeBtn = this.querySelector('#close-overlay');
						if (closeBtn) {
							closeBtn.addEventListener('click', () => {
								this.remove();
							});
						}
					}
				}
			}

			try {
				customElements.define('gemini-translation-overlay', GeminiTranslationOverlay);
				console.log('Web Component defined successfully');
			} catch (error) {
				console.error('Failed to define Web Component:', error);
				createDivOverlay(type, original, content);
				return;
			}
		}

		// Create the Web Component
		console.log('Creating Web Component instance for:', type);
		const overlay = document.createElement('gemini-translation-overlay');
		overlay.setAttribute('data-type', type);
		overlay.setAttribute('data-original', original);
		if (content) overlay.setAttribute('data-content', content);

		document.body.appendChild(overlay);
		console.log('Web Component overlay created successfully for type:', type);

	} else {
		console.warn('customElements API unavailable, using fallback div overlay');
		createDivOverlay(type, original, content);
	}
}

// Keep the div overlay as fallback
function createDivOverlay(type, original, content) {
	console.log('Creating fallback div overlay for:', type);

	let borderColor = '#d4d4d4';
	let title = 'AI Translation';
	let buttonStyle = `
    background: #ececec !important; 
    color: #464646 !important; 
    border: none !important; 
    width: 30px !important;
    height: 30px !important;
    border-radius: 50% !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    font-size: 16px !important;
    line-height: 1 !important;
  `;
	let contentHtml = '';

	// SVG close icon
	const closeIcon = `
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
      <path d="M13 1L1 13M1 1l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>
  `;

	if (type === 'loading') {
		contentHtml = `
      <div style="margin-bottom: 10px;">
        <strong>Original:</strong><br>
        <span style="background: #f8f9fa; padding: 5px; border-radius: 4px; display: inline-block;">${original}</span>
      </div>
      <div style="display: flex; align-items: center; gap: 10px;">
        <div style="width: 20px; height: 20px; border: 2px solid #f3f3f3; border-top: 2px solid #2c7ed1; border-radius: 50%; animation: spin 1s linear infinite;"></div>
        <strong>Translating...</strong>
      </div>
    `;
	} else if (type === 'translation') {
		contentHtml = `
      <div style="margin-bottom: 10px;">
        <strong>Original:</strong><br>
        <span style="background: #f8f9fa; padding: 5px; border-radius: 4px; display: inline-block;">${original}</span>
      </div>
      <div>
        <strong>Translated:</strong><br>
        <span style="background: #f8f9fa; padding: 5px; border-radius: 4px; display: inline-block;">${content}</span>
      </div>
    `;
	} else if (type === 'error') {
		title = 'Translation Error';
		borderColor = '#dc3545';
		buttonStyle = `
      background: #dc3545 !important; 
      color: white !important; 
      border: none !important;
      width: 30px !important;
      height: 30px !important;
      border-radius: 50% !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      font-size: 16px !important;
      line-height: 1 !important;
    `;
		contentHtml = `
      <div style="color: #721c24; padding: 10px; background: #f8d7da; border-radius: 4px;">
        ${content}
      </div>
    `;
	}

	const divOverlay = document.createElement('div');
	divOverlay.id = 'gemini-translation-overlay';
	divOverlay.style.cssText = `
    position: fixed !important; 
    top: 50% !important; 
    left: 50% !important; 
    transform: translate(-50%, -50%) !important;
    background: white !important; 
    border: 2px solid ${borderColor} !important; 
    border-radius: 8px !important;
    padding: 20px !important; 
    max-width: 90vw !important; 
    max-height: 80vh !important; 
    overflow-y: auto !important;
    z-index: 2147483647 !important; 
    box-shadow: 0 4px 20px rgba(0,0,0,0.3) !important;
    font-family: Arial, sans-serif !important; 
    font-size: 16px !important; 
    color: #000 !important;
    transition: border-color 0.2s ease-in-out;
  `;

	divOverlay.innerHTML = `
    <div style="display: flex !important; justify-content: space-between !important; align-items: center !important; margin-bottom: 15px !important;">
      <h4 style="margin: 0 !important; font-size: 16px !important;">${title}</h4>
      <button id="close-overlay" style="${buttonStyle} cursor: pointer !important;">
        ${closeIcon}
      </button>
    </div>
    ${contentHtml}
    <div class="api-info" style="margin-top: 15px; padding-top: 10px; border-top: 1px solid #eee; text-align: center; font-size: 12px; color: #666;">
      Made by <a href="https://aamu.app" target="_blank" style="color: #2c7ed1; text-decoration: none; font-weight: bold;">Aamu.app</a>
    </div>
  `;

	// Use event listener instead of inline onclick
	const closeBtn = divOverlay.querySelector('#close-overlay');
	if (closeBtn) {
		closeBtn.addEventListener('click', () => {
			divOverlay.remove();
		});
	}

	document.body.appendChild(divOverlay);
	console.log('Fallback div overlay created for type:', type);
}
