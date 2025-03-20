// background.js - Handles requests from the UI, runs the model, then sends back a response

// START OF kokoro.js phonemize.js
import { phonemize as espeakng } from "phonemizer";

/**
 * Helper function to split a string on a regex, but keep the delimiters.
 * This is required, because the JavaScript `.split()` method does not keep the delimiters,
 * and wrapping in a capturing group causes issues with existing capturing groups (due to nesting).
 * @param {string} text The text to split.
 * @param {RegExp} regex The regex to split on.
 * @returns {{match: boolean; text: string}[]} The split string.
 */
function split(text, regex) {
  const result = [];
  let prev = 0;
  for (const match of text.matchAll(regex)) {
    const fullMatch = match[0];
    if (prev < match.index) {
      result.push({ match: false, text: text.slice(prev, match.index) });
    }
    if (fullMatch.length > 0) {
      result.push({ match: true, text: fullMatch });
    }
    prev = match.index + fullMatch.length;
  }
  if (prev < text.length) {
    result.push({ match: false, text: text.slice(prev) });
  }
  return result;
}

/**
 * Helper function to split numbers into phonetic equivalents
 * @param {string} match The matched number
 * @returns {string} The phonetic equivalent
 */
function split_num(match) {
  if (match.includes(".")) {
    return match;
  } else if (match.includes(":")) {
    let [h, m] = match.split(":").map(Number);
    if (m === 0) {
      return `${h} o'clock`;
    } else if (m < 10) {
      return `${h} oh ${m}`;
    }
    return `${h} ${m}`;
  }
  let year = parseInt(match.slice(0, 4), 10);
  if (year < 1100 || year % 1000 < 10) {
    return match;
  }
  let left = match.slice(0, 2);
  let right = parseInt(match.slice(2, 4), 10);
  let suffix = match.endsWith("s") ? "s" : "";
  if (year % 1000 >= 100 && year % 1000 <= 999) {
    if (right === 0) {
      return `${left} hundred${suffix}`;
    } else if (right < 10) {
      return `${left} oh ${right}${suffix}`;
    }
  }
  return `${left} ${right}${suffix}`;
}

/**
 * Helper function to format monetary values
 * @param {string} match The matched currency
 * @returns {string} The formatted currency
 */
function flip_money(match) {
  const bill = match[0] === "$" ? "dollar" : "pound";
  if (isNaN(Number(match.slice(1)))) {
    return `${match.slice(1)} ${bill}s`;
  } else if (!match.includes(".")) {
    let suffix = match.slice(1) === "1" ? "" : "s";
    return `${match.slice(1)} ${bill}${suffix}`;
  }
  const [b, c] = match.slice(1).split(".");
  const d = parseInt(c.padEnd(2, "0"), 10);
  let coins = match[0] === "$" ? (d === 1 ? "cent" : "cents") : d === 1 ? "penny" : "pence";
  return `${b} ${bill}${b === "1" ? "" : "s"} and ${d} ${coins}`;
}

/**
 * Helper function to process decimal numbers
 * @param {string} match The matched number
 * @returns {string} The formatted number
 */
function point_num(match) {
  let [a, b] = match.split(".");
  return `${a} point ${b.split("").join(" ")}`;
}

/**
 * Normalize text for phonemization
 * @param {string} text The text to normalize
 * @returns {string} The normalized text
 */
function normalize_text(text) {
  return (
    text
      // 1. Handle quotes and brackets
      .replace(/[‘’]/g, "'")
      .replace(/«/g, "“")
      .replace(/»/g, "”")
      .replace(/[“”]/g, '"')
      .replace(/\(/g, "«")
      .replace(/\)/g, "»")

      // 2. Replace uncommon punctuation marks
      .replace(/、/g, ", ")
      .replace(/。/g, ". ")
      .replace(/！/g, "! ")
      .replace(/，/g, ", ")
      .replace(/：/g, ": ")
      .replace(/；/g, "; ")
      .replace(/？/g, "? ")

      // 3. Whitespace normalization
      .replace(/[^\S \n]/g, " ")
      .replace(/  +/, " ")
      .replace(/(?<=\n) +(?=\n)/g, "")

      // 4. Abbreviations
      .replace(/\bD[Rr]\.(?= [A-Z])/g, "Doctor")
      .replace(/\b(?:Mr\.|MR\.(?= [A-Z]))/g, "Mister")
      .replace(/\b(?:Ms\.|MS\.(?= [A-Z]))/g, "Miss")
      .replace(/\b(?:Mrs\.|MRS\.(?= [A-Z]))/g, "Mrs")
      .replace(/\betc\.(?! [A-Z])/gi, "etc")

      // 5. Normalize casual words
      .replace(/\b(y)eah?\b/gi, "$1e'a")

      // 5. Handle numbers and currencies
      .replace(/\d*\.\d+|\b\d{4}s?\b|(?<!:)\b(?:[1-9]|1[0-2]):[0-5]\d\b(?!:)/g, split_num)
      .replace(/(?<=\d),(?=\d)/g, "")
      .replace(/[$£]\d+(?:\.\d+)?(?: hundred| thousand| (?:[bm]|tr)illion)*\b|[$£]\d+\.\d\d?\b/gi, flip_money)
      .replace(/\d*\.\d+/g, point_num)
      .replace(/(?<=\d)-(?=\d)/g, " to ")
      .replace(/(?<=\d)S/g, " S")

      // 6. Handle possessives
      .replace(/(?<=[BCDFGHJ-NP-TV-Z])'?s\b/g, "'S")
      .replace(/(?<=X')S\b/g, "s")

      // 7. Handle hyphenated words/letters
      .replace(/(?:[A-Za-z]\.){2,} [a-z]/g, (m) => m.replace(/\./g, "-"))
      .replace(/(?<=[A-Z])\.(?=[A-Z])/gi, "-")

      // 8. Strip leading and trailing whitespace
      .trim()
  );
}

/**
 * Escapes regular expression special characters from a string by replacing them with their escaped counterparts.
 *
 * @param {string} string The string to escape.
 * @returns {string} The escaped string.
 */
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // $& means the whole matched string
}

const PUNCTUATION = ';:,.!?¡¿—…"«»“”(){}[]';
const PUNCTUATION_PATTERN = new RegExp(`(\\s*[${escapeRegExp(PUNCTUATION)}]+\\s*)+`, "g");

/**
 * Phonemize text using the eSpeak-NG phonemizer
 * @param {string} text The text to phonemize
 * @param {"a"|"b"} language The language to use
 * @param {boolean} norm Whether to normalize the text
 * @returns {Promise<string>} The phonemized text
 */
export async function phonemize(text, language = "a", norm = true) {
  // 1. Normalize text
  if (norm) {
    text = normalize_text(text);
  }

  // 2. Split into chunks, to ensure we preserve punctuation
  const sections = split(text, PUNCTUATION_PATTERN);

  // 3. Convert each section to phonemes
  const lang = language === "a" ? "en-us" : "en";
  const ps = (await Promise.all(sections.map(async ({ match, text }) => (match ? text : (await espeakng(text, lang)).join(" "))))).join("");

  // 4. Post-process phonemes
  let processed = ps
    // https://en.wiktionary.org/wiki/kokoro#English
    .replace(/kəkˈoːɹoʊ/g, "kˈoʊkəɹoʊ")
    .replace(/kəkˈɔːɹəʊ/g, "kˈəʊkəɹəʊ")
    .replace(/ʲ/g, "j")
    .replace(/r/g, "ɹ")
    .replace(/x/g, "k")
    .replace(/ɬ/g, "l")
    .replace(/(?<=[a-zɹː])(?=hˈʌndɹɪd)/g, " ")
    .replace(/ z(?=[;:,.!?¡¿—…"«»“” ]|$)/g, "z");

  // 5. Additional post-processing for American English
  if (language === "a") {
    processed = processed.replace(/(?<=nˈaɪn)ti(?!ː)/g, "di");
  }
  return processed.trim();
}

// END OF kokoro.js phonemize.js

import { env, pipeline } from '@huggingface/transformers';
// Remove custom pipeline import as we'll use the standard pipeline

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

// Kokoro TTS Pipeline Singleton - direct model loading approach
class KokoroPipelineSingleton {
    static model_id = 'onnx-community/Kokoro-82M-v1.0-ONNX';
    static instance = null;
    static tokenizer = null;
    static model = null;
    static voiceCache = new Map(); // Cache for voice data
    
    // Voice mapping constants - using correct voice names from Kokoro.js
    static VOICES = {
        af_heart: "African female (Heart)",
        af_alloy: "African female (Alloy)", 
        af_aoede: "African female (Aoede)",
        af_bella: "African female (Bella)",
        af_jessica: "African female (Jessica)",
        af_kore: "African female (Kore)",
        af_nicole: "African female (Nicole)",
        af_nova: "African female (Nova)",
        af_river: "African female (River)",
        af_sarah: "African female (Sarah)",
        af_sky: "African female (Sky)",
        am_adam: "American male (Adam)",
        am_echo: "American male (Echo)",
        am_eric: "American male (Eric)",
        am_fenrir: "American male (Fenrir)",
        am_liam: "American male (Liam)",
        am_michael: "American male (Michael)",
        am_onyx: "American male (Onyx)",
        am_puck: "American male (Puck)",
        am_santa: "American male (Santa)",
        bf_emma: "British female (Emma)",
        bf_isabella: "British female (Isabella)",
        bm_george: "British male (George)",
        bm_lewis: "British male (Lewis)"
    };
    static SAMPLE_RATE = 24000;
    static STYLE_DIM = 256;
    static VOICE_DATA_URL = "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/voices";

    // Load voice data from HuggingFace
    static async getVoiceData(voice) {
        if (this.voiceCache.has(voice)) {
            return this.voiceCache.get(voice);
        }

        const url = `${this.VOICE_DATA_URL}/${voice}.bin`;
        console.log("Fetching voice data from:", url);
        
        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Failed to fetch voice data: ${response.status} ${response.statusText}`);
            }
            
            const buffer = await response.arrayBuffer();
            const voiceData = new Float32Array(buffer);
            
            this.voiceCache.set(voice, voiceData);
            return voiceData;
        } catch (error) {
            console.error("Error loading voice data:", error);
            throw error;
        }
    }

    static async getInstance(progress_callback = null) {
        if (this.instance === null) {
            try {
                console.log("Initializing Kokoro TTS directly...");
                
                // We need to manually load the tokenizer and model
                const { AutoTokenizer, Tensor, PreTrainedModel } = await import('@huggingface/transformers');
                
                // Initialize tokenizer
                this.tokenizer = await AutoTokenizer.from_pretrained(this.model_id, { 
                    progress_callback
                });
                
                console.log("Tokenizer loaded successfully");
                
                // Initialize model using standard PreTrainedModel approach
                this.model = await PreTrainedModel.from_pretrained(this.model_id, {
                    progress_callback,
                    model_file: 'model.onnx'
                });
                
                console.log("Model loaded successfully");
                
                // Create a new instance to hold references
                this.instance = {
                    tokenizer: this.tokenizer,
                    model: this.model,
                    // Add a generate method that resembles the Kokoro.js implementation
                    async generate(text, { voice = "am_michael", speed = 1.0 } = {}) {
                        // Validate voice exists
                        if (!KokoroPipelineSingleton.VOICES.hasOwnProperty(voice)) {
                            console.error(`Voice "${voice}" not found. Available voices:`, KokoroPipelineSingleton.VOICES);
                            throw new Error(`Voice "${voice}" not found. Should be one of: ${Object.keys(KokoroPipelineSingleton.VOICES).join(", ")}.`);
                        }
                        
                        // Extract language code (a/b) from voice name
                        const language = voice.charAt(0);
                        
                        // Use the imported phonemize function from the top of the file
                        // This is the original phonemize function from Kokoro.js
                        console.log("Phonemizing text with original Kokoro phonemizer...");
                        const phonemes = await phonemize(text, language);
                        console.log("Phonemized text:", phonemes);
                        
                        // Tokenize the phonemized text
                        const { input_ids } = KokoroPipelineSingleton.tokenizer(phonemes, {
                            truncation: true,
                        });
                        
                        // Calculate token count for voice style selection
                        const num_tokens = Math.min(Math.max(input_ids.dims.at(-1) - 2, 0), 509);
                        console.log("Token count:", num_tokens);
                        
                        // Load voice style data
                        const voiceData = await KokoroPipelineSingleton.getVoiceData(voice);
                        console.log("Voice data loaded, length:", voiceData.length);
                        
                        // Calculate offset based on token count
                        const offset = num_tokens * KokoroPipelineSingleton.STYLE_DIM;
                        console.log("Using offset:", offset);
                        
                        // Extract the voice style vector at the specific offset
                        const styleVector = voiceData.slice(offset, offset + KokoroPipelineSingleton.STYLE_DIM);
                        console.log("Style vector length:", styleVector.length);
                        
                        // Create input tensors
                        const style = new Tensor("float32", styleVector, [1, KokoroPipelineSingleton.STYLE_DIM]);
                        const speedTensor = new Tensor("float32", [speed], [1]);
                        
                        // Prepare model inputs
                        const inputs = {
                            input_ids,
                            style,
                            speed: speedTensor
                        };
                        
                        // Run the model
                        console.log("Running model with inputs:", {
                            input_ids_shape: input_ids.dims,
                            style_shape: style.dims,
                            speed_shape: speedTensor.dims
                        });
                        
                        const outputs = await KokoroPipelineSingleton.model(inputs);
                        console.log("Model outputs received");
                        
                        // Create a RawAudio object
                        const { RawAudio } = await import('@huggingface/transformers');
                        return new RawAudio(
                            outputs.waveform.data,
                            KokoroPipelineSingleton.SAMPLE_RATE
                        );
                    }
                };
                
            } catch (error) {
                console.error("Error initializing Kokoro TTS directly:", error);
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

// Create function for Kokoro TTS generation
const generateKokoroSpeech = async (text) => {
    console.log("Starting Kokoro speech generation for:", text.substring(0, 50) + "...");
    
    try {
        // Log available backends in transformers.js
        console.log("Available backends:", env.backends);
        
        // Get the Kokoro TTS pipeline instance with progress logging
        let kokoro = await KokoroPipelineSingleton.getInstance((progress) => {
            console.log("Kokoro TTS model loading progress:", progress);
        });
        
        console.log("Kokoro TTS model loaded successfully");
        
        // Generate speech with an American male voice
        console.log("Generating Kokoro audio...");
        const voice = 'am_michael'; // American male (Michael) - confirmed to exist
        const speed = 1.0;
        
        // Use the custom generate method we defined in the singleton
        const result = await kokoro.generate(text, { voice, speed });
        
        console.log("Kokoro audio generated successfully");
        
        // Return the audio with its sampling rate
        return result;
    } catch (error) {
        console.error("Kokoro speech generation error:", error);
        
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
    
    // Add a new context menu item for Kokoro TTS
    chrome.contextMenus.create({
        id: 'kokoro-speak-selection',
        title: 'Speak "%s" (Kokoro)',
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
    
    // Handle Kokoro TTS menu item
    else if (info.menuItemId === 'kokoro-speak-selection') {
        // Notify the user that we're processing
        chrome.scripting.executeScript({
            target: { tabId: tab.id },
            function: () => {
                // Remove existing overlay if it exists
                const existingOverlay = document.getElementById('transformers-js-overlay');
                if (existingOverlay) {
                    document.body.removeChild(existingOverlay);
                }
                
                // Create processing overlay
                const overlay = document.createElement('div');
                overlay.id = 'transformers-js-overlay';
                overlay.style.position = 'fixed';
                overlay.style.bottom = '20px';
                overlay.style.right = '20px';
                overlay.style.backgroundColor = '#2d2d2d';
                overlay.style.color = '#ffffff';
                overlay.style.padding = '15px 20px';
                overlay.style.borderRadius = '8px';
                overlay.style.boxShadow = '0 2px 10px rgba(0, 0, 0, 0.2)';
                overlay.style.zIndex = '9999';
                overlay.style.width = '250px';
                overlay.style.fontSize = '14px';
                
                const label = document.createElement('div');
                label.style.fontWeight = 'bold';
                label.textContent = 'Generating speech...';
                
                const progress = document.createElement('div');
                progress.textContent = 'Loading Kokoro TTS model';
                
                overlay.appendChild(label);
                overlay.appendChild(progress);
                document.body.appendChild(overlay);
            }
        });
        
        try {
            // Generate speech from the selected text using Kokoro
            let result = await generateKokoroSpeech(info.selectionText);
            
            // Get the audio data
            const audioData = result.audio;
            
            // Display a notification and play the audio
            chrome.scripting.executeScript({
                target: { tabId: tab.id },
                args: [Array.from(audioData), result.sampling_rate, info.selectionText.substring(0, 50) + (info.selectionText.length > 50 ? '...' : '')],
                function: (audioArray, sampleRate, textPreview) => {
                    // Remove loading overlay if exists
                    const existingOverlay = document.getElementById('transformers-js-overlay');
                    if (existingOverlay) {
                        document.body.removeChild(existingOverlay);
                    }
                    
                    // Convert the array back to a Float32Array
                    const audioData = new Float32Array(audioArray);
                    
                    // Convert audio data to wav format
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
                    overlay.style.padding = '15px 20px';
                    overlay.style.borderRadius = '8px';
                    overlay.style.boxShadow = '0 2px 10px rgba(0, 0, 0, 0.2)';
                    overlay.style.zIndex = '9999';
                    overlay.style.width = '250px';
                    overlay.style.fontSize = '14px';
                    overlay.style.transition = 'opacity 0.3s ease-in-out';
                    
                    const label = document.createElement('div');
                    label.style.fontWeight = 'bold';
                    label.style.marginBottom = '10px';
                    label.textContent = 'Kokoro TTS';
                    
                    const text = document.createElement('div');
                    text.textContent = `"${textPreview}"`;
                    
                    const playingIndicator = document.createElement('div');
                    playingIndicator.style.marginTop = '10px';
                    playingIndicator.style.fontSize = '12px';
                    playingIndicator.textContent = 'Playing audio...';
                    
                    // Add a close button
                    const closeButton = document.createElement('button');
                    closeButton.textContent = '×';
                    closeButton.style.position = 'absolute';
                    closeButton.style.top = '5px';
                    closeButton.style.right = '10px';
                    closeButton.style.background = 'none';
                    closeButton.style.border = 'none';
                    closeButton.style.color = '#ffffff';
                    closeButton.style.fontSize = '20px';
                    closeButton.style.cursor = 'pointer';
                    closeButton.onclick = () => {
                        document.body.removeChild(overlay);
                        audioElement.pause();
                        URL.revokeObjectURL(audioUrl); // Clean up
                    };
                    
                    overlay.appendChild(closeButton);
                    overlay.appendChild(label);
                    overlay.appendChild(text);
                    overlay.appendChild(playingIndicator);
                    document.body.appendChild(overlay);
                    
                    // Auto-remove after playback ends
                    audioElement.onended = () => {
                        playingIndicator.textContent = 'Playback complete';
                        setTimeout(() => {
                            overlay.style.opacity = '0';
                            setTimeout(() => {
                                if (document.body.contains(overlay)) {
                                    document.body.removeChild(overlay);
                                }
                                URL.revokeObjectURL(audioUrl); // Clean up
                            }, 300);
                        }, 2000);
                    };
                    
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
                    
                    // Helper function to write strings to the WAV header
                    function writeString(view, offset, string) {
                        for (let i = 0; i < string.length; i++) {
                            view.setUint8(offset + i, string.charCodeAt(i));
                        }
                    }
                }
            });
        } catch (error) {
            console.error('Kokoro TTS error:', error);
            
            // Show error message
            chrome.scripting.executeScript({
                target: { tabId: tab.id },
                args: [error.toString()],
                function: (errorMessage) => {
                    // Update or create the overlay to show the error
                    let overlay = document.getElementById('transformers-js-overlay');
                    if (!overlay) {
                        overlay = document.createElement('div');
                        overlay.id = 'transformers-js-overlay';
                        overlay.style.position = 'fixed';
                        overlay.style.bottom = '20px';
                        overlay.style.right = '20px';
                        overlay.style.backgroundColor = '#2d2d2d';
                        overlay.style.color = '#ffffff';
                        overlay.style.padding = '15px 20px';
                        overlay.style.borderRadius = '8px';
                        overlay.style.boxShadow = '0 2px 10px rgba(0, 0, 0, 0.2)';
                        overlay.style.zIndex = '9999';
                        overlay.style.width = '250px';
                        overlay.style.fontSize = '14px';
                        document.body.appendChild(overlay);
                    }
                    
                    // Clear existing content
                    overlay.innerHTML = '';
                    
                    const label = document.createElement('div');
                    label.style.fontWeight = 'bold';
                    label.style.color = '#ff6b6b';
                    label.textContent = 'Kokoro TTS Error';
                    
                    const message = document.createElement('div');
                    message.style.marginTop = '10px';
                    message.style.fontSize = '12px';
                    message.textContent = errorMessage.substring(0, 150) + (errorMessage.length > 150 ? '...' : '');
                    
                    overlay.appendChild(label);
                    overlay.appendChild(message);
                    
                    // Auto-remove after 8 seconds
                    setTimeout(() => {
                        if (document.body.contains(overlay)) {
                            document.body.removeChild(overlay);
                        }
                    }, 8000);
                }
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

