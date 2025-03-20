// background.js - Handles requests from the UI, runs the model, then sends back a response

import { pipeline, env } from '@huggingface/transformers';
// Remove Kokoro TTS import as we'll use the transformers.js pipeline directly

// Configure transformers.js environment
// This is critical for proper WASM handling in Chrome extensions
env.useBrowserCache = false; // Don't use browser cache for models
env.allowLocalModels = false; // Don't look for models on disk
// Don't set explicit WASM paths as they'll be handled by the extension

class PipelineSingleton {
    static task = 'text-classification';
    static model = 'Xenova/distilbert-base-uncased-finetuned-sst-2-english';
    static instance = null;

    static async getInstance(progress_callback = null) {
        this.instance ??= pipeline(this.task, this.model, { progress_callback });

        return this.instance;
    }
}

// TTS Pipeline Singleton
class TTSPipelineSingleton {
    static task = 'text-to-speech';
    static model = 'Xenova/speecht5_tts'; // Use Transformers.js built-in TTS model
    static instance = null;

    static async getInstance(progress_callback = null) {
        if (this.instance === null) {
            try {
                console.log("Initializing TTS pipeline...");
                
                // Initialize TTS using transformers.js pipeline
                this.instance = await pipeline(this.task, this.model, { 
                    progress_callback: progress_callback
                });
                
                console.log("TTS pipeline initialized successfully");
            } catch (error) {
                console.error("Error initializing TTS pipeline:", error);
                throw error;
            }
        }
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

// Create function for TTS generation
const generateSpeech = async (text) => {
    console.log("Starting speech generation for:", text.substring(0, 50) + "...");
    
    try {
        // Log available backends in transformers.js
        console.log("Available backends:", env.backends);
        
        // Get the TTS pipeline instance with progress logging
        let tts = await TTSPipelineSingleton.getInstance((progress) => {
            console.log("TTS model loading progress:", progress);
        });
        
        console.log("TTS model loaded successfully");
        
        // Generate speech from the text
        console.log("Generating audio...");
        // Use the correct speaker embeddings URL from HuggingFace documentation
        const speaker_embeddings = 'https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/speaker_embeddings.bin';
        const result = await tts(text, { speaker_embeddings });
        
        console.log("Audio generated successfully");
        return result;
    } catch (error) {
        console.error("Speech generation error:", error);
        
        // Enhanced error information
        let detailedError = {
            message: error.message,
            stack: error.stack,
            name: error.name,
            transformersEnv: {
                backendConfig: env.backends,
                useBrowserCache: env.useBrowserCache,
                allowLocalModels: env.allowLocalModels
            }
        };
        
        console.error("Detailed error:", JSON.stringify(detailedError, null, 2));
        throw error;
    }
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
    
    // Add a new context menu item for TTS
    chrome.contextMenus.create({
        id: 'speak-selection',
        title: 'Speak "%s"',
        contexts: ['selection'],
    });
});

// Perform inference when the user clicks a context menu
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    // Handle classification menu item
    if (info.menuItemId === 'classify-selection' && info.selectionText) {
        // Show loading indicator for classification
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
            target: { tabId: tab.id },
            args: [result],
            function: (result) => {
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
    }
    
    // Handle speech menu item
    else if (info.menuItemId === 'speak-selection' && info.selectionText) {
        // Show loading indicator for TTS
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
                title.textContent = 'Generating speech...';
                
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

        try {
            // Generate speech from the selected text
            let result = await generateSpeech(info.selectionText);
            
            // Get the audio data
            // The transformers.js TTS pipeline returns an object with audio data, not an Audio object
            const audioData = result.audio;
            
            // Display a notification and play the audio
            chrome.scripting.executeScript({
                target: { tabId: tab.id },
                args: [Array.from(audioData), info.selectionText.substring(0, 50) + (info.selectionText.length > 50 ? '...' : '')],
                function: (audioArray, textPreview) => {
                    // Remove loading overlay if exists
                    const existingOverlay = document.getElementById('transformers-js-overlay');
                    if (existingOverlay) {
                        document.body.removeChild(existingOverlay);
                    }
                    
                    // Create audio element and play it
                    // Convert the array back to a Float32Array
                    const audioData = new Float32Array(audioArray);
                    
                    // Convert audio data to wav format
                    const sampleRate = 16000; // SpeechT5 uses 16kHz
                    const wav = createWaveFile(audioData, sampleRate);
                    const audioBlob = new Blob([wav], { type: 'audio/wav' });
                    const audioUrl = URL.createObjectURL(audioBlob);
                    const audioElement = new Audio(audioUrl);
                    audioElement.play();
                    
                    // Create a styled div to show the speech notification
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
                    
                    // Display speaking notification
                    const title = document.createElement('div');
                    title.style.fontWeight = 'bold';
                    title.style.color = '#ffffff';
                    title.style.marginBottom = '10px';
                    title.style.fontSize = '16px';
                    title.textContent = 'Speaking:';
                    
                    const text = document.createElement('div');
                    text.style.color = '#ffffff';
                    text.textContent = textPreview;
                    
                    overlay.appendChild(title);
                    overlay.appendChild(text);
                    
                    // Add audio controls
                    const controls = document.createElement('div');
                    controls.style.marginTop = '15px';
                    controls.style.display = 'flex';
                    controls.style.justifyContent = 'space-between';
                    
                    // Pause/play button
                    const playPauseBtn = document.createElement('button');
                    playPauseBtn.textContent = '⏸️';
                    playPauseBtn.style.background = 'none';
                    playPauseBtn.style.border = '1px solid #fff';
                    playPauseBtn.style.borderRadius = '4px';
                    playPauseBtn.style.color = '#fff';
                    playPauseBtn.style.padding = '5px 10px';
                    playPauseBtn.style.cursor = 'pointer';
                    playPauseBtn.onclick = () => {
                        if (audioElement.paused) {
                            audioElement.play();
                            playPauseBtn.textContent = '⏸️';
                        } else {
                            audioElement.pause();
                            playPauseBtn.textContent = '▶️';
                        }
                    };
                    
                    // Stop button
                    const stopBtn = document.createElement('button');
                    stopBtn.textContent = '⏹️';
                    stopBtn.style.background = 'none';
                    stopBtn.style.border = '1px solid #fff';
                    stopBtn.style.borderRadius = '4px';
                    stopBtn.style.color = '#fff';
                    stopBtn.style.padding = '5px 10px';
                    stopBtn.style.cursor = 'pointer';
                    stopBtn.onclick = () => {
                        audioElement.pause();
                        audioElement.currentTime = 0;
                        playPauseBtn.textContent = '▶️';
                    };
                    
                    controls.appendChild(playPauseBtn);
                    controls.appendChild(stopBtn);
                    overlay.appendChild(controls);
                    
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
                    closeBtn.onclick = () => {
                        audioElement.pause();
                        document.body.removeChild(overlay);
                        URL.revokeObjectURL(audioUrl); // Clean up
                    };
                    overlay.appendChild(closeBtn);
                    
                    // Remove the overlay when audio ends
                    audioElement.onended = () => {
                        setTimeout(() => {
                            if (document.body.contains(overlay)) {
                                overlay.style.opacity = '0';
                                setTimeout(() => {
                                    if (document.body.contains(overlay)) {
                                        document.body.removeChild(overlay);
                                        URL.revokeObjectURL(audioUrl); // Clean up
                                    }
                                }, 300);
                            }
                        }, 1000);
                    };
                    
                    document.body.appendChild(overlay);
                    
                    // Function to create WAV file from audio data
                    function createWaveFile(audioData, sampleRate) {
                        // Create buffer for the WAV file
                        const buffer = new ArrayBuffer(44 + audioData.length * 2);
                        const view = new DataView(buffer);
                        
                        // Write WAV header
                        // "RIFF" chunk descriptor
                        writeString(view, 0, 'RIFF');
                        view.setUint32(4, 36 + audioData.length * 2, true);
                        writeString(view, 8, 'WAVE');
                        
                        // "fmt " sub-chunk
                        writeString(view, 12, 'fmt ');
                        view.setUint32(16, 16, true); // fmt chunk size
                        view.setUint16(20, 1, true); // audio format (1 for PCM)
                        view.setUint16(22, 1, true); // number of channels
                        view.setUint32(24, sampleRate, true); // sample rate
                        view.setUint32(28, sampleRate * 2, true); // byte rate
                        view.setUint16(32, 2, true); // block align
                        view.setUint16(34, 16, true); // bits per sample
                        
                        // "data" sub-chunk
                        writeString(view, 36, 'data');
                        view.setUint32(40, audioData.length * 2, true);
                        
                        // Write audio data
                        const volume = 0.5;
                        for (let i = 0; i < audioData.length; i++) {
                            // Convert float audio data to int16
                            const sample = Math.max(-1, Math.min(1, audioData[i]));
                            view.setInt16(44 + i * 2, sample * 32767 * volume, true);
                        }
                        
                        return buffer;
                    }
                    
                    function writeString(view, offset, string) {
                        for (let i = 0; i < string.length; i++) {
                            view.setUint8(offset + i, string.charCodeAt(i));
                        }
                    }
                },
            });
        } catch (error) {
            // Show error message if speech generation fails
            chrome.scripting.executeScript({
                target: { tabId: tab.id },
                args: [error.toString()],
                function: (errorMessage) => {
                    // Remove loading overlay if exists
                    const existingOverlay = document.getElementById('transformers-js-overlay');
                    if (existingOverlay) {
                        document.body.removeChild(existingOverlay);
                    }
                    
                    // Create error notification
                    const overlay = document.createElement('div');
                    overlay.id = 'transformers-js-overlay';
                    overlay.style.position = 'fixed';
                    overlay.style.bottom = '20px';
                    overlay.style.right = '20px';
                    overlay.style.backgroundColor = '#d32f2f';
                    overlay.style.color = '#ffffff';
                    overlay.style.padding = '15px 20px 20px 20px';
                    overlay.style.borderRadius = '8px';
                    overlay.style.boxShadow = '0 2px 10px rgba(0, 0, 0, 0.2)';
                    overlay.style.zIndex = '9999';
                    overlay.style.width = '250px';
                    overlay.style.fontSize = '14px';
                    overlay.style.transition = 'opacity 0.3s ease-in-out';
                    
                    // Error title
                    const title = document.createElement('div');
                    title.style.fontWeight = 'bold';
                    title.style.color = '#ffffff';
                    title.style.marginBottom = '10px';
                    title.style.fontSize = '16px';
                    title.textContent = 'Error generating speech';
                    
                    // Error message
                    const message = document.createElement('div');
                    message.style.color = '#ffffff';
                    message.textContent = errorMessage;
                    
                    overlay.appendChild(title);
                    overlay.appendChild(message);
                    
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
        }
    }
});

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

