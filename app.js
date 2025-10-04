import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, query, orderBy, limit, onSnapshot, addDoc, serverTimestamp } from 'firebase/firestore';

// --- Global Variables (Provided by Canvas Environment) ---
// MANDATORY: Use these global variables for Firebase configuration and authentication.
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : null;
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// API Configuration
const GEMINI_MODEL = "gemini-2.5-flash-preview-05-20";
const API_URL_BASE = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// JSON Schema for structured multimodal response
const ANALYSIS_RESPONSE_SCHEMA = {
    type: "OBJECT",
    properties: {
        health_percentage: { type: "NUMBER", description: "The estimated health of the plant as a percentage (0 to 100). Must be an integer." },
        predicted_disease: { type: "STRING", description: "The predicted disease or 'Healthy' if no disease is found. Must be concise." },
        home_remedies: {
            type: "ARRAY",
            description: "A list of 3-5 actionable, home-based remedies using common household items like soap, baking soda, etc. The first item should always be a summary of the status.",
            items: { type: "STRING" }
        }
    },
    required: ["health_percentage", "predicted_disease", "home_remedies"]
};

// --- Utility Functions ---

/**
 * Executes an exponential backoff retry mechanism for an async function.
 * @param {function} fn - The async function to execute.
 * @param {number} maxRetries - Maximum number of retries.
 * @returns {Promise<any>} The result of the async function.
 */
async function retryWithBackoff(fn, maxRetries = 5) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await fn();
        } catch (error) {
            if (i === maxRetries - 1) throw error; // Re-throw on last attempt
            const delay = Math.pow(2, i) * 1000 + Math.random() * 1000;
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

/**
 * Converts a File object (image) to a Base64 string.
 * @param {File} file - The image file object.
 * @returns {Promise<string>} Base64 data string.
 */
const fileToBase64 = (file) => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = error => reject(error);
        reader.readAsDataURL(file);
    });
};

// --- Components ---

const PlantScanner = () => {
  const [file, setFile] = useState(null);
  const [scanResult, setScanResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile) {
      setFile(selectedFile);
      setScanResult(null); // Clear previous result
      setError(null);
    }
  };

  const handleScan = async () => {
    if (!file) return;

    setLoading(true);
    setScanResult(null);
    setError(null);

    try {
      // 1. Convert image to Base64
      const base64ImageData = await fileToBase64(file);
      const mimeType = file.type || 'image/png';

      // 2. Define the user prompt for multimodal analysis
      const userPrompt = "Analyze this image of a plant. Determine its health percentage (0-100), predict the specific disease, or state 'Healthy'. Provide 3 to 5 actionable home remedies using common household products like soap, vinegar, or baking soda. If the plant is healthy, provide general care tips instead of remedies. Respond ONLY in the requested JSON format.";

      // 3. Construct the API payload
      const payload = {
        contents: [
            {
                role: "user",
                parts: [
                    { text: userPrompt },
                    {
                        inlineData: {
                            mimeType: mimeType,
                            data: base64ImageData
                        }
                    }
                ]
            }
        ],
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: ANALYSIS_RESPONSE_SCHEMA
        }
      };

      const apiKey = ""; // Canvas provides this at runtime
      const apiUrl = `${API_URL_BASE}?key=${apiKey}`;

      // 4. API call with exponential backoff
      const apiCall = async () => {
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (!response.ok) {
          throw new Error(`API call failed with status: ${response.status}`);
        }
        return response.json();
      };

      const result = await retryWithBackoff(apiCall);
      
      const jsonText = result.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!jsonText) throw new Error("API response was empty or malformed.");

      // 5. Parse and validate JSON response
      const parsedResult = JSON.parse(jsonText);
      if (typeof parsedResult.health_percentage !== 'number') {
        throw new Error("Invalid health percentage received.");
      }
      
      setScanResult(parsedResult);

    } catch (err) {
      console.error("Scanning Error:", err);
      setError("Analysis failed. Please try a clearer picture or ask the bot for help.");
    } finally {
      setLoading(false);
    }
  };

  const getHealthColor = (health) => {
    if (health >= 80) return 'text-green-600 bg-green-100 border-green-300';
    if (health >= 60) return 'text-yellow-600 bg-yellow-100 border-yellow-300';
    return 'text-red-600 bg-red-100 border-red-300';
  };

  const isDiseased = scanResult && scanResult.predicted_disease.toLowerCase() !== "healthy";

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-lg mx-auto">
      <h2 className="text-2xl font-extrabold text-gray-800 border-b pb-2">Plant Health Scanner</h2>
      <p className="text-sm text-gray-600">Upload a clear, focused photo of your plant's affected leaf/area for AI-powered disease and health analysis.</p>

      <div className="flex flex-col items-center p-6 border-2 border-dashed border-green-300 rounded-xl bg-white shadow-inner">
        {file ? (
          <img
            src={URL.createObjectURL(file)}
            alt="Uploaded Plant"
            className="w-full h-40 object-cover rounded-lg mb-4 shadow-md"
          />
        ) : (
          <svg className="w-12 h-12 text-green-500 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-9-2h.01M4 20h16a2 2 0 002-2V6a2 2 0 00-2-2H4a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
        )}
        {/* IMPORTANT CHANGE: Added capture="environment" to allow camera input on mobile devices */}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          capture="environment" 
          onChange={handleFileChange}
          className="hidden"
        />
        <button
          onClick={() => inputRef.current.click()}
          className="px-4 py-2 text-sm font-semibold rounded-full bg-green-500 text-white hover:bg-green-600 transition shadow-lg hover:shadow-xl transform hover:scale-[1.02]"
          disabled={loading}
        >
          {file ? 'Change/Retake Photo' : 'Select or Capture Photo'}
        </button>
      </div>

      <button
        onClick={handleScan}
        disabled={!file || loading}
        className={`w-full py-3 text-lg font-bold rounded-xl transition transform ${
          file && !loading
            ? 'bg-green-600 text-white hover:bg-green-700 shadow-xl hover:shadow-2xl'
            : 'bg-gray-300 text-gray-500 cursor-not-allowed'
        }`}
      >
        {loading ? (
            <span className="flex items-center justify-center">
                <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" viewBox="0 0 24 24">
                   <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                   <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Analyzing Image...
            </span>
        ) : 'Scan for Diseases'}
      </button>
      
      {error && (
        <div className="p-4 bg-red-100 border border-red-400 text-red-700 rounded-lg">
            <p className="font-semibold">Error:</p>
            <p className="text-sm">{error}</p>
        </div>
      )}

      {scanResult && (
        <div className="mt-6 p-5 border-t-4 border-green-500 bg-white rounded-xl shadow-2xl space-y-4">
          <div className="flex justify-between items-center pb-2 border-b border-gray-200">
            <h3 className="text-xl font-bold text-gray-800">Scan Results</h3>
            <span className={`px-4 py-1 rounded-full text-lg font-bold border ${getHealthColor(scanResult.health_percentage)}`}>
              {scanResult.health_percentage}% Health
            </span>
          </div>

          <p className="text-md text-gray-700">
            **Predicted Status:** <span className="font-extrabold text-lg text-green-700 capitalize">{scanResult.predicted_disease}</span>
          </p>

          <div className="pt-4 border-t border-gray-200">
              <h4 className="text-lg font-semibold text-gray-800 mb-3 flex items-center">
                <svg className={`w-5 h-5 mr-2 ${isDiseased ? 'text-red-600' : 'text-green-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={isDiseased ? "M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" : "M5 13l4 4L19 7"}></path></svg>
                {isDiseased ? 'DIY Home Remedies' : 'General Care Tips'}
              </h4>
              <ul className="list-disc list-inside space-y-2 text-gray-700 text-sm pl-4">
                {scanResult.home_remedies.map((remedy, index) => (
                  <li key={index}>
                    {remedy}
                  </li>
                ))}
              </ul>
            </div>
        </div>
      )}
    </div>
  );
};

const GardeningBot = ({ db, userId }) => {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef(null);

  const CHAT_COLLECTION = `artifacts/${appId}/users/${userId}/plant_bot_chats`;

  // Scroll to bottom on new message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Fetch and listen for chat history
  useEffect(() => {
    if (!db || !userId) return;

    // Use onSnapshot for real-time updates
    const q = query(collection(db, CHAT_COLLECTION), orderBy('timestamp', 'asc'), limit(50));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const chatHistory = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })).filter(msg => msg.text);

      setMessages(chatHistory);
    }, (error) => {
      console.error("Error listening to chat history:", error);
    });

    return () => unsubscribe();
  }, [db, userId]);

  const callGeminiApi = async (userMessage) => {
    // Filter out messages without text property before sending to API
    const validMessages = messages.filter(msg => msg.text);

    const chatHistoryForAPI = validMessages.map(msg => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.text }]
    }));

    const systemPrompt = "You are a friendly, knowledgeable, and practical home gardening expert and plant doctor. Your responses should be concise, encouraging, and focused on home remedies and simple, actionable care tips. Use common language and acknowledge the user's plant. When giving vacation tips, always prioritize simple, proven methods like wicking or bottle watering. Do not use external tools or markdown headers. Your only goal is to provide helpful, actionable advice.";
    
    const payload = {
      contents: [...chatHistoryForAPI, { role: 'user', parts: [{ text: userMessage }] }],
      systemInstruction: {
        parts: [{ text: systemPrompt }]
      }
    };
    
    const apiKey = ""; // Canvas will provide this at runtime
    const apiUrl = `${API_URL_BASE}?key=${apiKey}`;

    const apiCall = async () => {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        throw new Error(`API call failed with status: ${response.status}`);
      }
      return response.json();
    };

    try {
      const result = await retryWithBackoff(apiCall);
      const botResponse = result.candidates?.[0]?.content?.parts?.[0]?.text;
      
      if (botResponse) {
        // Save the bot's response to Firestore
        await addDoc(collection(db, CHAT_COLLECTION), {
          role: 'model',
          text: botResponse,
          timestamp: serverTimestamp()
        });
      }
    } catch (error) {
      console.error("Gemini API Error:", error);
      // Save error message to Firestore
      await addDoc(collection(db, CHAT_COLLECTION), {
        role: 'model',
        text: "Oops! I ran into a technical issue. The gardening bot is on a coffee break. Please try your question again.",
        timestamp: serverTimestamp()
      });
    }
  };

  const handleSend = async (e) => {
    e.preventDefault();
    if (!input.trim() || loading || !db || !userId) return;

    const userMessage = input.trim();
    setInput('');
    setLoading(true);

    // 1. Save user message to Firestore
    await addDoc(collection(db, CHAT_COLLECTION), {
      role: 'user',
      text: userMessage,
      timestamp: serverTimestamp()
    });
    
    // 2. Call Gemini for response (response saving is handled within callGeminiApi)
    await callGeminiApi(userMessage);

    setLoading(false);
  };

  return (
    <div className="flex flex-col h-[70vh] max-w-lg mx-auto bg-white rounded-xl shadow-2xl">
      <h2 className="text-2xl font-extrabold text-gray-800 p-4 border-b pb-2 rounded-t-xl">AI Gardener Bot</h2>
      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50 rounded-b-lg shadow-inner">
        {messages.length === 0 && (
          <div className="text-center text-gray-500 italic p-10">
            Start a conversation! Ask me anything about plant care, watering schedules, or what to do before a vacation.
          </div>
        )}
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] px-4 py-2 rounded-xl shadow-md ${
                msg.role === 'user'
                  ? 'bg-green-500 text-white rounded-br-none'
                  : 'bg-white text-gray-800 rounded-tl-none border border-gray-200'
              }`}
            >
              <p className="whitespace-pre-wrap">{msg.text}</p>
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="max-w-[80%] px-4 py-2 rounded-xl bg-white text-gray-800 rounded-tl-none border border-gray-200 shadow-md">
              <span className="animate-pulse">Bot is typing...</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
      <form onSubmit={handleSend} className="p-4 bg-white border-t rounded-b-xl flex">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask your plant question..."
          className="flex-1 px-4 py-2 border border-gray-300 rounded-l-xl focus:ring-green-500 focus:border-green-500 transition"
          disabled={loading}
        />
        <button
          type="submit"
          disabled={!input.trim() || loading}
          className={`px-4 py-2 rounded-r-xl font-semibold transition transform shadow-lg ${
            !input.trim() || loading
              ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
              : 'bg-green-600 text-white hover:bg-green-700 hover:scale-[1.01]'
          }`}
        >
          Send
        </button>
      </form>
    </div>
  );
};

// --- Main App Component ---

const App = () => {
  const [db, setDb] = useState(null);
  const [auth, setAuth] = useState(null);
  const [userId, setUserId] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [view, setView] = useState('scanner'); // 'scanner' or 'bot'

  // Initialize Firebase and handle Authentication
  useEffect(() => {
    if (firebaseConfig) {
      const app = initializeApp(firebaseConfig);
      const firestore = getFirestore(app);
      const authInstance = getAuth(app);

      setDb(firestore);
      setAuth(authInstance);

      // 1. Handle Authentication
      const authenticate = async () => {
        try {
          if (initialAuthToken) {
            await signInWithCustomToken(authInstance, initialAuthToken);
          } else {
            await signInAnonymously(authInstance);
          }
        } catch (error) {
          console.error("Firebase Auth Error:", error);
          // Fallback to anonymous sign-in if custom token fails
          try {
            await signInAnonymously(authInstance);
          } catch (e) {
            console.error("Anonymous sign-in failed:", e);
          }
        }
      };

      authenticate();

      // 2. Set up Auth State Listener
      const unsubscribe = onAuthStateChanged(authInstance, (user) => {
        if (user) {
          setUserId(user.uid);
        } else {
          // Fallback user ID if somehow not signed in
          setUserId(crypto.randomUUID());
        }
        setIsAuthReady(true);
      });

      return () => unsubscribe();
    }
  }, []);

  if (!isAuthReady) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-100">
        <div className="text-center p-8 bg-white rounded-xl shadow-lg">
          <svg className="animate-spin h-8 w-8 text-green-500 mx-auto mb-3" viewBox="0 0 24 24">
             <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
             <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <p className="text-gray-700">Loading Garden Companion...</p>
        </div>
      </div>
    );
  }

  const renderContent = () => {
    if (view === 'scanner') {
      return <PlantScanner />;
    }
    return <GardeningBot db={db} userId={userId} />;
  };

  return (
    <div className="min-h-screen bg-green-50 font-sans p-2 sm:p-4">
      <header className="text-center py-6">
        <h1 className="text-4xl font-black text-green-800">
          <span className="text-6xl mr-2">🌿</span>Home Garden Health
        </h1>
        <p className="text-sm text-gray-500 mt-1">Logged in as User ID: <span className="font-mono text-xs p-1 bg-gray-200 rounded">{userId}</span></p>
      </header>

      <div className="max-w-xl mx-auto mb-4 bg-white rounded-full shadow-lg p-1 flex">
        <button
          onClick={() => setView('scanner')}
          className={`flex-1 py-3 px-4 font-bold rounded-full transition transform ${
            view === 'scanner'
              ? 'bg-green-600 text-white shadow-md'
              : 'text-gray-600 hover:bg-green-100'
          }`}
        >
          <span className="mr-2">📸</span>Plant Scanner
        </button>
        <button
          onClick={() => setView('bot')}
          className={`flex-1 py-3 px-4 font-bold rounded-full transition transform ${
            view === 'bot'
              ? 'bg-green-600 text-white shadow-md'
              : 'text-gray-600 hover:bg-green-100'
          }`}
        >
          <span className="mr-2">💬</span>AI Gardener Bot
        </button>
      </div>

      <main className="pb-10">
        {renderContent()}
      </main>
    </div>
  );
};

export default App;
