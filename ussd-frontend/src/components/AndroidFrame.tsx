import React, { useState, useEffect } from 'react';
import '../styles/AndroidFrame.css';
import { PhoneManager } from '../services/PhoneManager';
import { USSDService } from '../services/USSDService';

interface AndroidFrameProps {
  phoneNumber: string;      // e.g., "08031234567"
  isRegistered: boolean;    // whether this phone is already registered
  onDialClick: (payload: string) => void; // callback for non-USSD dials or logging
}

type Screen = 'home' | 'dialer' | 'messages';

const AndroidFrame: React.FC<AndroidFrameProps> = ({
  phoneNumber,
  isRegistered,
  onDialClick
}) => {
  // UI navigation
  const [currentScreen, setCurrentScreen] = useState<Screen>('home');
  
  // Real-time clock state
  const [currentTime, setCurrentTime] = useState(new Date());
  
  // Dialer input and simple editing
  const [dialedNumber, setDialedNumber] = useState<string>('');
  
  // Session phone number (changes on each *789# call)
  const [sessionPhoneNumber, setSessionPhoneNumber] = useState<string>(phoneNumber);
  const [sessionRegistered, setSessionRegistered] = useState<boolean>(isRegistered);
  
  // USSD overlays
  const [isProcessingUSSD, setIsProcessingUSSD] = useState<boolean>(false);
  const [showUSSDSheet, setShowUSSDSheet] = useState<boolean>(false);
  
  // USSD session state
  const [ussdResponse, setUssdResponse] = useState<string>('');
  const [ussdInput, setUssdInput] = useState<string>('');
  const [sessionId, setSessionId] = useState<string>('');

  // Real-time clock effect
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Format time for display
  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
  };

  // Format date for display
  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-GB', {
      weekday: 'long',
      month: 'long',
      day: 'numeric'
    });
  };

  // Check if we're on a PIN step (for password masking)
  const isPinStep = ussdResponse.toLowerCase().includes('pin');

  // ----- Helpers -----
  const addToDialed = (digit: string) => setDialedNumber(prev => prev + digit);
  const clearLastDigit = () => setDialedNumber(prev => prev.slice(0, -1));
  const clearAllDigits = () => setDialedNumber('');

  const parsePurchaseAmount = (code: string): number | null => {
    // *789*AMOUNT#
    const m = code.match(/^\*789\*(\d+)#$/);
    return m ? parseInt(m[1], 10) : null;
  };

  const withinAmountBounds = (n: number) => n >= 100 && n <= 50000;

  const resetSession = () => {
    setUssdInput('');
    setSessionId('');
  };

  // ----- Backend-integrated USSD handling -----
  const handleCall = async () => {
    const input = dialedNumber.trim();
    const isUSSD = input.includes('*') && input.includes('#');

    if (!isUSSD) {
      onDialClick(input);
      return;
    }

    // Generate new phone number for each *789# call
    let currentSessionPhone = sessionPhoneNumber;
    if (input === '*789#') {
      currentSessionPhone = PhoneManager.generateRandomNumber();
      setSessionPhoneNumber(currentSessionPhone);
    }

    // Generate session ID based on USSD type
    let newSessionId = '';
    const amount = parsePurchaseAmount(input);
    
    if (input === '*789#') {
      newSessionId = `registration_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    } else if (amount !== null) {
      if (!withinAmountBounds(amount)) {
        setIsProcessingUSSD(true);
        setTimeout(() => {
          setIsProcessingUSSD(false);
          setShowUSSDSheet(true);
          setUssdResponse('Amount must be between N100 and N50,000.');
          setUssdInput('');
        }, 600);
        return;
      }
      newSessionId = `purchase_${amount}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    } else {
      setIsProcessingUSSD(true);
      setTimeout(() => {
        setIsProcessingUSSD(false);
        setShowUSSDSheet(true);
        setUssdResponse('Invalid USSD code.\n\nValid codes:\n*789# - Register\n*789*AMOUNT# - Purchase');
        setUssdInput('');
      }, 600);
      return;
    }

    setSessionId(newSessionId);
    setIsProcessingUSSD(true);

    try {
      // Call your backend API
      const response = await USSDService.startSession(newSessionId, currentSessionPhone);
      
      setIsProcessingUSSD(false);
      setShowUSSDSheet(true);
      setUssdResponse(response.message);
      setUssdInput('');

    } catch (error) {
      console.error('Backend connection error:', error);
      setIsProcessingUSSD(false);
      setShowUSSDSheet(true);
      setUssdResponse(`Connection Error:\n${error instanceof Error ? error.message : 'Unknown error'}\n\nPlease check your connection and try again.`);
      setUssdInput('');
    }
  };

  const handleUSSDCancel = async () => {
    setShowUSSDSheet(false);
    if (sessionId) {
      try {
        await USSDService.endSession(sessionId);
      } catch (error) {
        console.log('End session error (non-critical):', error);
      }
    }
    resetSession();
  };

  const handleUSSDSend = async () => {
    const input = (ussdInput || '').trim();
    
    if (!input) {
      return;
    }

    try {
      // Use backend API instead of local logic
      const response = await USSDService.continueSession(sessionId, sessionPhoneNumber, input);
      
      setUssdResponse(response.message);
      setUssdInput('');

      // If session ended by backend
      if (response.end) {
        setTimeout(() => {
          setShowUSSDSheet(false);
          resetSession();
        }, 4000);
      }

    } catch (error) {
      console.error('USSD continue error:', error);
      setUssdResponse(`Error: ${error instanceof Error ? error.message : 'Unknown error'}\n\nPress Cancel to exit.`);
    }
  };

  // ----- Screens -----
  const renderHomeScreen = () => (
    <div className="samsung-screen">
      <div className="samsung-home">
        {/* Real-Time Widget */}
        <div className="samsung-time-widget">
          <div className="samsung-time">{formatTime(currentTime)}</div>
          <div className="samsung-date">{formatDate(currentTime)}</div>
        </div>

        {/* App Grid */}
        <div className="samsung-app-grid">
          <div className="app-grid-row">
            {/* Phone */}
            <button
              className="samsung-app-icon"
              onClick={() => setCurrentScreen('dialer')}
            >
              <div className="samsung-icon-circle phone-icon">
                <svg viewBox="0 0 24 24" fill="white" width="24" height="24">
                  <path d="M6.62,10.79C8.06,13.62 10.38,15.94 13.21,17.38L15.41,15.18C15.69,14.9 16.08,14.82 16.43,14.93C17.55,15.3 18.75,15.5 20,15.5A1,1 0 0,1 21,16.5V20A1,1 0 0,1 20,21A17,17 0 0,1 3,4A1,1 0 0,1 4,3H7.5A1,1 0 0,1 8.5,4C8.5,5.25 8.7,6.45 9.07,7.57C9.18,7.92 9.1,8.31 8.82,8.59L6.62,10.79Z"/>
                </svg>
              </div>
              <span className="samsung-app-label">Phone</span>
            </button>

            {/* Messages - Authentic Samsung UI Icon */}
            <button
              className="samsung-app-icon"
              onClick={() => setCurrentScreen('messages')}
            >
              <div className="samsung-icon-circle messages-icon">
                <svg viewBox="0 0 24 24" fill="white" width="24" height="24">
                  <path d="M12,3C6.5,3 2,6.58 2,11C2,13.78 3.64,16.18 6.08,17.64L5.25,21.58C5.22,21.74 5.28,21.9 5.4,22C5.52,22.1 5.69,22.1 5.82,22L10.83,19.65C11.21,19.71 11.6,19.74 12,19.74C17.5,19.74 22,16.16 22,11.74C22,6.58 17.5,3 12,3M8.5,9.5A1.5,1.5 0 0,1 10,11A1.5,1.5 0 0,1 8.5,12.5A1.5,1.5 0 0,1 7,11A1.5,1.5 0 0,1 8.5,9.5M12,9.5A1.5,1.5 0 0,1 13.5,11A1.5,1.5 0 0,1 12,12.5A1.5,1.5 0 0,1 10.5,11A1.5,1.5 0 0,1 12,9.5M15.5,9.5A1.5,1.5 0 0,1 17,11A1.5,1.5 0 0,1 15.5,12.5A1.5,1.5 0 0,1 14,11A1.5,1.5 0 0,1 15.5,9.5Z"/>
                </svg>
              </div>
              <span className="samsung-app-label">Messages</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  const renderDialerScreen = () => (
    <div className="samsung-screen">
      <div className="samsung-dialer">
        {/* Header */}
        <div className="samsung-dialer-header">
          <h2>Phone</h2>
          <div className="samsung-header-actions">
            <span className="samsung-search-icon">🔍</span>
            <span className="samsung-menu-icon">⋮</span>
          </div>
        </div>

        {/* Number Display Area */}
        <div className="samsung-number-area">
          <div className="samsung-dialed-number">{dialedNumber || ' '}</div>
          {/* Show link always (dim if empty) to match One UI */}
          <button
            className="samsung-add-contact"
            style={{ opacity: dialedNumber ? 1 : 0.35 }}
          >
            + Add to Contacts
          </button>
        </div>

        {/* Keypad */}
        <div className="samsung-keypad">
          <div className="samsung-keypad-row">
            <button className="samsung-keypad-key" onClick={() => addToDialed('1')}>
              <span className="samsung-key-number">1</span>
            </button>
            <button className="samsung-keypad-key" onClick={() => addToDialed('2')}>
              <span className="samsung-key-number">2</span>
              <span className="samsung-key-letters">ABC</span>
            </button>
            <button className="samsung-keypad-key" onClick={() => addToDialed('3')}>
              <span className="samsung-key-number">3</span>
              <span className="samsung-key-letters">DEF</span>
            </button>
          </div>

          <div className="samsung-keypad-row">
            <button className="samsung-keypad-key" onClick={() => addToDialed('4')}>
              <span className="samsung-key-number">4</span>
              <span className="samsung-key-letters">GHI</span>
            </button>
            <button className="samsung-keypad-key" onClick={() => addToDialed('5')}>
              <span className="samsung-key-number">5</span>
              <span className="samsung-key-letters">JKL</span>
            </button>
            <button className="samsung-keypad-key" onClick={() => addToDialed('6')}>
              <span className="samsung-key-number">6</span>
              <span className="samsung-key-letters">MNO</span>
            </button>
          </div>

          <div className="samsung-keypad-row">
            <button className="samsung-keypad-key" onClick={() => addToDialed('7')}>
              <span className="samsung-key-number">7</span>
              <span className="samsung-key-letters">PQRS</span>
            </button>
            <button className="samsung-keypad-key" onClick={() => addToDialed('8')}>
              <span className="samsung-key-number">8</span>
              <span className="samsung-key-letters">TUV</span>
            </button>
            <button className="samsung-keypad-key" onClick={() => addToDialed('9')}>
              <span className="samsung-key-number">9</span>
              <span className="samsung-key-letters">WXYZ</span>
            </button>
          </div>

          <div className="samsung-keypad-row">
            <button className="samsung-keypad-key" onClick={() => addToDialed('*')}>
              <span className="samsung-key-number">*</span>
            </button>
            <button className="samsung-keypad-key" onClick={() => addToDialed('0')}>
              <span className="samsung-key-number">0</span>
              <span className="samsung-key-letters">+</span>
            </button>
            <button className="samsung-keypad-key" onClick={() => addToDialed('#')}>
              <span className="samsung-key-number">#</span>
            </button>
          </div>
        </div>

        {/* Action Bar — single SIM (always visible) */}
        <div className="samsung-action-bar">
          <button
            className="samsung-action-btn message-btn"
            title="Messages"
            onClick={() => setCurrentScreen('messages')}
          >
            <svg viewBox="0 0 24 24" fill="white" width="20" height="20">
              <path d="M12,3C6.5,3 2,6.58 2,11C2,13.78 3.64,16.18 6.08,17.64L5.25,21.58C5.22,21.74 5.28,21.9 5.4,22C5.52,22.1 5.69,22.1 5.82,22L10.83,19.65C11.21,19.71 11.6,19.74 12,19.74C17.5,19.74 22,16.16 22,11.74C22,6.58 17.5,3 12,3M8.5,9.5A1.5,1.5 0 0,1 10,11A1.5,1.5 0 0,1 8.5,12.5A1.5,1.5 0 0,1 7,11A1.5,1.5 0 0,1 8.5,9.5M12,9.5A1.5,1.5 0 0,1 13.5,11A1.5,1.5 0 0,1 12,12.5A1.5,1.5 0 0,1 10.5,11A1.5,1.5 0 0,1 12,9.5M15.5,9.5A1.5,1.5 0 0,1 17,11A1.5,1.5 0 0,1 15.5,12.5A1.5,1.5 0 0,1 14,11A1.5,1.5 0 0,1 15.5,9.5Z"/>
            </svg>
          </button>
          <button className="samsung-call-btn" onClick={handleCall} title="Call">
            <span className="samsung-call-icon">📞</span>
          </button>
          <button
            className="samsung-action-btn delete-btn"
            onClick={dialedNumber ? clearLastDigit : undefined}
            style={{ opacity: dialedNumber ? 1 : 0.35 }}
            title="Backspace"
          >
            ⌫
          </button>
        </div>

        {/* Bottom Tabs */}
        <div className="samsung-bottom-tabs">
          <div className="samsung-tab active">
            <span className="samsung-tab-icon">⊞</span>
            <span className="samsung-tab-label">Keypad</span>
          </div>
          <div className="samsung-tab">
            <span className="samsung-tab-icon">🕒</span>
            <span className="samsung-tab-label">Recents</span>
          </div>
          <div className="samsung-tab">
            <span className="samsung-tab-icon">👥</span>
            <span className="samsung-tab-label">Contacts</span>
          </div>
          <div className="samsung-tab">
            <span className="samsung-tab-icon">📍</span>
            <span className="samsung-tab-label">Places</span>
          </div>
        </div>

        {/* USSD Processing Toast */}
        {isProcessingUSSD && (
          <div className="samsung-ussd-toast">
            <div className="samsung-toast-content">
              <div className="samsung-spinner" />
              <span className="samsung-toast-text">USSD code running...</span>
            </div>
          </div>
        )}

        {/* USSD Sheet */}
        {showUSSDSheet && (
          <div className="samsung-ussd-overlay">
            <div className="samsung-ussd-sheet">
              <div className="samsung-sheet-header">
                <h3>USSD</h3>
              </div>
              <div className="samsung-sheet-content">
                <pre className="samsung-ussd-message">{ussdResponse}</pre>
                {/* Mask + numeric-only + max 4 when on PIN steps */}
                <input
                  className="samsung-ussd-input"
                  type={isPinStep ? 'password' : 'text'}
                  inputMode={isPinStep ? 'numeric' : 'text'}
                  pattern={isPinStep ? '\\d*' : undefined}
                  maxLength={isPinStep ? 4 : 30}
                  autoComplete="off"
                  spellCheck={false}
                  value={ussdInput}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (isPinStep) {
                      const digits = val.replace(/\D/g, '').slice(0, 4);
                      setUssdInput(digits);
                    } else {
                      setUssdInput(val);
                    }
                  }}
                  onPaste={(e) => {
                    if (isPinStep) e.preventDefault(); // optional: block paste for PIN
                  }}
                  placeholder={isPinStep ? 'Enter 4-digit PIN' : 'Enter your response'}
                />
              </div>
              <div className="samsung-sheet-actions">
                <button className="samsung-sheet-btn cancel" onClick={handleUSSDCancel}>
                  Cancel
                </button>
                <button className="samsung-sheet-btn send" onClick={handleUSSDSend}>
                  Send
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  const renderMessagesScreen = () => (
    <div className="samsung-screen">
      <div className="samsung-messages">
        <div className="samsung-messages-header">
          <button onClick={() => setCurrentScreen('home')}>←</button>
          <h2>Messages</h2>
        </div>
        <div className="samsung-messages-content">
          <p>
            Welcome! Current session phone <strong>{sessionPhoneNumber}</strong> will be used for USSD transactions.
          </p>
          <p style={{ fontSize: '0.85rem', opacity: 0.7, marginTop: '12px' }}>
            Each time you dial *789#, a new random Nigerian phone number is generated for the session.
          </p>
          
          {/* Backend Connection Status */}
          <div style={{ 
            marginTop: '16px', 
            padding: '12px', 
            backgroundColor: '#f0f0f0', 
            borderRadius: '8px',
            fontSize: '0.85rem'
          }}>
            <strong>Backend Status:</strong><br/>
            API URL: {process.env.REACT_APP_API_URL || 'http://localhost:3002'}<br/>
            <em>Try dialing *789# to test backend connection</em>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="samsung-frame">
      <div className="samsung-device">
        {/* Punch Hole */}
        <div className="samsung-punch-hole" />

        {/* Status Bar with Real-Time */}
        <div className="samsung-status-bar">
          <div className="samsung-status-left">
            <span className="samsung-time-status">{formatTime(currentTime)}</span>
          </div>
          <div className="samsung-status-right">
            <span className="samsung-network">4G</span>
            <span className="samsung-signal">●●●●</span>
            <span className="samsung-battery">86%</span>
          </div>
        </div>

        {/* Screen Content */}
        {currentScreen === 'home' && renderHomeScreen()}
        {currentScreen === 'dialer' && renderDialerScreen()}
        {currentScreen === 'messages' && renderMessagesScreen()}

        {/* Navigation Bar with App Icons */}
        <div className="samsung-navbar">
          <div className="samsung-nav-btn" onClick={() => setCurrentScreen('home')}>◀</div>
          <div className="samsung-nav-btn home" onClick={() => setCurrentScreen('home')}>⚫</div>
          <div className="samsung-nav-btn dialer-nav" onClick={() => setCurrentScreen('dialer')}>
            <svg viewBox="0 0 24 24" fill="white" width="18" height="18">
              <path d="M6.62,10.79C8.06,13.62 10.38,15.94 13.21,17.38L15.41,15.18C15.69,14.9 16.08,14.82 16.43,14.93C17.55,15.3 18.75,15.5 20,15.5A1,1 0 0,1 21,16.5V20A1,1 0 0,1 20,21A17,17 0 0,1 3,4A1,1 0 0,1 4,3H7.5A1,1 0 0,1 8.5,4C8.5,5.25 8.7,6.45 9.07,7.57C9.18,7.92 9.1,8.31 8.82,8.59L6.62,10.79Z"/>
            </svg>
          </div>
          <div className="samsung-nav-btn messages-nav" onClick={() => setCurrentScreen('messages')}>
            <svg viewBox="0 0 24 24" fill="white" width="18" height="18">
              <path d="M12,3C6.5,3 2,6.58 2,11C2,13.78 3.64,16.18 6.08,17.64L5.25,21.58C5.22,21.74 5.28,21.9 5.4,22C5.52,22.1 5.69,22.1 5.82,22L10.83,19.65C11.21,19.71 11.6,19.74 12,19.74C17.5,19.74 22,16.16 22,11.74C22,6.58 17.5,3 12,3M8.5,9.5A1.5,1.5 0 0,1 10,11A1.5,1.5 0 0,1 8.5,12.5A1.5,1.5 0 0,1 7,11A1.5,1.5 0 0,1 8.5,9.5M12,9.5A1.5,1.5 0 0,1 13.5,11A1.5,1.5 0 0,1 12,12.5A1.5,1.5 0 0,1 10.5,11A1.5,1.5 0 0,1 12,9.5M15.5,9.5A1.5,1.5 0 0,1 17,11A1.5,1.5 0 0,1 15.5,12.5A1.5,1.5 0 0,1 14,11A1.5,1.5 0 0,1 15.5,9.5Z"/>
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AndroidFrame;
