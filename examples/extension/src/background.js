// background.js - Handles requests from the UI, runs the model, then sends back a response

import { pipeline } from '@huggingface/transformers';

class PipelineSingleton {
    static task = 'text-classification';
    static model = 'Xenova/distilbert-base-uncased-finetuned-sst-2-english';
    static instance = null;

    static async getInstance(progress_callback = null) {
        this.instance ??= pipeline(this.task, this.model, { progress_callback });

        return this.instance;
    }
}

// Create generic classify function, which will be reused for the different types of events.
const classify = async (text) => {
    // Get the pipeline instance. This will load and build the model when run for the first time.
    let model = await PipelineSingleton.getInstance((data) => {
        // You can track the progress of the pipeline creation here.
        // e.g., you can send `data` back to the UI to indicate a progress bar
        // console.log('progress', data)
    });

    // Actually run the model on the input text
    let result = await model(text);
    return result;
};

////////////////////// 1. Context Menus //////////////////////
//
// Add a listener to create the initial context menu items,
// context menu items only need to be created at runtime.onInstalled
chrome.runtime.onInstalled.addListener(function () {
    // Register a context menu item that will only show up for selection text.
    chrome.contextMenus.create({
        id: 'classify-selection',
        title: 'Classify "%s"',
        contexts: ['selection'],
    });
});

// Perform inference when the user clicks a context menu
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    // Ignore context menu clicks that are not for classifications (or when there is no input)
    if (info.menuItemId !== 'classify-selection' || !info.selectionText) return;

    // First show loading indicator
    chrome.scripting.executeScript({
        target: { tabId: tab.id },
        function: () => {
            // Create a styled div for the loading indicator
            const loadingOverlay = document.createElement('div');
            loadingOverlay.id = 'transformers-js-overlay';
            loadingOverlay.style.position = 'fixed';
            loadingOverlay.style.bottom = '20px';
            loadingOverlay.style.right = '20px';
            loadingOverlay.style.backgroundColor = '#2d2d2d';
            loadingOverlay.style.color = '#ffffff';
            loadingOverlay.style.padding = '15px 20px 20px 20px';
            loadingOverlay.style.borderRadius = '8px';
            loadingOverlay.style.boxShadow = '0 2px 10px rgba(0, 0, 0, 0.2)';
            loadingOverlay.style.zIndex = '9999';
            loadingOverlay.style.width = '250px';
            loadingOverlay.style.fontSize = '14px';
            
            // Add title
            const title = document.createElement('div');
            title.style.fontWeight = 'bold';
            title.style.marginBottom = '15px';
            title.style.fontSize = '16px';
            title.textContent = 'Analyzing text...';
            
            // Create spinner
            const spinner = document.createElement('div');
            spinner.style.display = 'inline-block';
            spinner.style.width = '20px';
            spinner.style.height = '20px';
            spinner.style.border = '3px solid rgba(255,255,255,.3)';
            spinner.style.borderRadius = '50%';
            spinner.style.borderTopColor = '#fff';
            spinner.style.animation = 'spin 1s linear infinite';
            
            // Add spinning animation
            const style = document.createElement('style');
            style.textContent = '@keyframes spin { to { transform: rotate(360deg); } }';
            document.head.appendChild(style);
            
            loadingOverlay.appendChild(title);
            loadingOverlay.appendChild(spinner);
            
            // Add close button
            const closeBtn = document.createElement('button');
            closeBtn.textContent = '×';
            closeBtn.style.position = 'absolute';
            closeBtn.style.top = '10px';
            closeBtn.style.right = '10px';
            closeBtn.style.border = 'none';
            closeBtn.style.background = 'none';
            closeBtn.style.fontSize = '22px';
            closeBtn.style.cursor = 'pointer';
            closeBtn.style.color = '#ffffff';
            closeBtn.style.padding = '0 5px';
            closeBtn.style.lineHeight = '1';
            closeBtn.onclick = () => document.body.removeChild(loadingOverlay);
            loadingOverlay.appendChild(closeBtn);
            
            document.body.appendChild(loadingOverlay);
        },
    });

    // Perform classification on the selected text
    let result = await classify(info.selectionText);

    // Display the result in a small overlay on the page
    chrome.scripting.executeScript({
        target: { tabId: tab.id },    // Run in the tab that the user clicked in
        args: [result],               // The arguments to pass to the function
        function: (result) => {       // The function to run
            // Remove loading overlay if exists
            const existingOverlay = document.getElementById('transformers-js-overlay');
            if (existingOverlay) {
                document.body.removeChild(existingOverlay);
            }
            
            // Create a styled div to show the result
            const overlay = document.createElement('div');
            overlay.id = 'transformers-js-overlay';
            overlay.style.position = 'fixed';
            overlay.style.bottom = '20px';
            overlay.style.right = '20px';
            overlay.style.backgroundColor = '#2d2d2d';
            overlay.style.color = '#ffffff';
            overlay.style.padding = '15px 20px 20px 20px';
            overlay.style.borderRadius = '8px';
            overlay.style.boxShadow = '0 2px 10px rgba(0, 0, 0, 0.2)';
            overlay.style.zIndex = '9999';
            overlay.style.width = '250px';
            overlay.style.fontSize = '14px';
            overlay.style.transition = 'opacity 0.3s ease-in-out';
            
            // Display the classification result
            const label = document.createElement('div');
            label.style.fontWeight = 'bold';
            label.style.color = '#ffffff';
            label.style.marginBottom = '10px';
            label.style.fontSize = '16px';
            label.textContent = `Classification: ${result[0].label}`;
            
            const score = document.createElement('div');
            score.style.color = '#ffffff';
            score.textContent = `Confidence: ${(result[0].score * 100).toFixed(2)}%`;
            
            overlay.appendChild(label);
            overlay.appendChild(score);
            
            // Add close button
            const closeBtn = document.createElement('button');
            closeBtn.textContent = '×';
            closeBtn.style.position = 'absolute';
            closeBtn.style.top = '10px';
            closeBtn.style.right = '10px';
            closeBtn.style.border = 'none';
            closeBtn.style.background = 'none';
            closeBtn.style.fontSize = '22px';
            closeBtn.style.cursor = 'pointer';
            closeBtn.style.color = '#ffffff';
            closeBtn.style.padding = '0 5px';
            closeBtn.style.lineHeight = '1';
            closeBtn.onclick = () => document.body.removeChild(overlay);
            overlay.appendChild(closeBtn);
            
            // Auto-remove after 10 seconds
            setTimeout(() => {
                if (document.body.contains(overlay)) {
                    overlay.style.opacity = '0';
                    setTimeout(() => {
                        if (document.body.contains(overlay)) {
                            document.body.removeChild(overlay);
                        }
                    }, 300);
                }
            }, 10000);
            
            document.body.appendChild(overlay);
        },
    });
});
//////////////////////////////////////////////////////////////

////////////////////// 2. Message Events /////////////////////
// 
// Listen for messages from the UI, process it, and send the result back.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('sender', sender)
    if (message.action !== 'classify') return; // Ignore messages that are not meant for classification.

    // Run model prediction asynchronously
    (async function () {
        // Perform classification
        let result = await classify(message.text);

        // Send response back to UI
        sendResponse(result);
    })();

    // return true to indicate we will send a response asynchronously
    // see https://stackoverflow.com/a/46628145 for more information
    return true;
});
//////////////////////////////////////////////////////////////

