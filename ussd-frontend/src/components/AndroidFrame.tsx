import React, { useState, useEffect } from 'react';
import '../styles/AndroidFrame.css';
import { PhoneManager } from '../services/PhoneManager';
import { USSDService } from '../services/USSDService';

interface AndroidFrameProps {
  phoneNumber: string;
  isRegistered: boolean;
  onDialClick: (payload: string) => void;
}

type Screen = 'home' | 'dialer' | 'messages';

const AndroidFrame: React.FC<AndroidFrameProps> = ({
  phoneNumber,
  isRegistered,
  onDialClick
}) => {
  const [currentScreen, setCurrentScreen] = useState<Screen>('home');
  const [currentTime, setCurrentTime] = useState(new Date());
  const [dialedNumber, setDialedNumber] = useState<string>('');
  const [sessionPhoneNumber, setSessionPhoneNumber] = useState<string>(phoneNumber);
  const [isProcessingUSSD, setIsProcessingUSSD] = useState<boolean>(false);
  const [showUSSDSheet, setShowUSSDSheet] = useState<boolean>(false);
  const [ussdResponse, setUssdResponse] = useState<string>('');
  const [ussdInput, setUssdInput] = useState<string>('');
  const [sessionId, setSessionId] = useState<string>('');

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Watch for wallet connection trigger
  useEffect(() => {
    if (ussdResponse.includes('[WALLET_CONNECT:')) {
      const match = ussdResponse.match(/\[WALLET_CONNECT:([a-f0-9]+)\]/);
      if (match) {
        const connectionId = match[1];
        console.log('🔗 Detected wallet connection trigger:', connectionId);
        
        // Clean the message
        const cleanMessage = ussdResponse.replace(/\[WALLET_CONNECT:[a-f0-9]+\]/, '').trim();
        setUssdResponse(cleanMessage);
        
        // Trigger wallet connection
        setTimeout(() => {
          handleWalletConnection(connectionId);
        }, 1500);
      }
    }
  }, [ussdResponse]);

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
  };

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-GB', {
      weekday: 'long',
      month: 'long',
      day: 'numeric'
    });
  };

  const isPinStep = ussdResponse.toLowerCase().includes('pin');
  const addToDialed = (digit: string) => setDialedNumber(prev => prev + digit);
  const clearLastDigit = () => setDialedNumber(prev => prev.slice(0, -1));

  // Parse USSD code and extract components
  const parseUSSDCode = (code: string): {
    type: 'register' | 'purchase' | 'invalid';
    amount?: number;
    pin?: string;
    recipient?: string;
  } | null => {
    // Registration: *789#
    if (code === '*789#') {
      return { type: 'register' };
    }

    // Pattern 1: *789*RECIPIENT*AMOUNT*PIN# (send to other)
    let match = code.match(/^\*789\*(\d{11})\*(\d+)\*(\d{4,6})#$/);
    if (match) {
      return {
        type: 'purchase',
        recipient: match[1],
        amount: parseInt(match[2], 10),
        pin: match[3]
      };
    }

    // Pattern 2: *789*AMOUNT*PIN# (buy for self)
    match = code.match(/^\*789\*(\d+)\*(\d{4,6})#$/);
    if (match) {
      return {
        type: 'purchase',
        amount: parseInt(match[1], 10),
        pin: match[2]
      };
    }

    // Pattern 3: *789*AMOUNT# (fallback)
    match = code.match(/^\*789\*(\d+)#$/);
    if (match) {
      return {
        type: 'purchase',
        amount: parseInt(match[1], 10)
      };
    }

    return { type: 'invalid' };
  };

  const withinAmountBounds = (n: number) => n >= 100 && n <= 50000;

  const resetSession = () => {
    setUssdInput('');
    setSessionId('');
  };

  const handleWalletConnection = async (connectionId: string) => {
    console.log('🔗 Initiating mock wallet connection for:', connectionId);
    
    const mockWalletAddress = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
    
    try {
      setUssdResponse('🔗 Opening wallet app...\n\nPlease approve connection in your wallet');
      
      // Simulate user approval delay
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      setUssdResponse('✅ Wallet approved\n\nLinking to phone number...');
      
      // Call backend webhook
      const result = await USSDService.completeWalletConnection(
        connectionId,
        mockWalletAddress
      );
      
      if (result.success) {
        console.log('✅ Wallet linked successfully:', result);
        
        // Register phone
        PhoneManager.registerPhone(sessionPhoneNumber);
        
        setUssdResponse(
          `✅ Wallet Linked!\n\n` +
          `Phone: ${result.phone}\n` +
          `Wallet: ${mockWalletAddress.substring(0, 4)}...${mockWalletAddress.slice(-4)}\n\n` +
          `Dial *789*AMOUNT*PIN# to transact`
        );
        
        // Auto-close after 4 seconds
        setTimeout(() => {
          setShowUSSDSheet(false);
          resetSession();
        }, 4000);
      } else {
        throw new Error(result.error || 'Wallet linking failed');
      }
      
    } catch (err: any) {
      console.error('❌ Wallet connection error:', err);
      setUssdResponse(`❌ Wallet linking failed\n\n${err.message}\n\nPress Cancel to exit`);
    }
  };

  const handleCall = async () => {
    const input = dialedNumber.trim();
    const isUSSD = input.includes('*') && input.includes('#');

    if (!isUSSD) {
      onDialClick(input);
      return;
    }

    // Parse USSD code
    const parsed = parseUSSDCode(input);
    
    if (!parsed || parsed.type === 'invalid') {
      setIsProcessingUSSD(true);
      setTimeout(() => {
        setIsProcessingUSSD(false);
        setShowUSSDSheet(true);
        setUssdResponse('Invalid USSD code.\n\nValid formats:\n*789# - Register\n*789*AMOUNT*PIN# - Purchase\n*789*RECIPIENT*AMOUNT*PIN# - Send');
        setUssdInput('');
      }, 600);
      return;
    }

    // Generate new phone number for registration
    let currentSessionPhone = sessionPhoneNumber;
    if (parsed.type === 'register') {
      currentSessionPhone = PhoneManager.generateRandomNumber();
      setSessionPhoneNumber(currentSessionPhone);
    }

    // Validate amount if present
    if (parsed.amount && !withinAmountBounds(parsed.amount)) {
      setIsProcessingUSSD(true);
      setTimeout(() => {
        setIsProcessingUSSD(false);
        setShowUSSDSheet(true);
        setUssdResponse('Amount must be between N100 and N50,000.');
        setUssdInput('');
      }, 600);
      return;
    }

    // Generate session ID matching backend expectations
    const timestamp = Date.now();
    let newSessionId = '';
    
    if (parsed.type === 'register') {
      newSessionId = `registration_${timestamp}`;
    } else if (parsed.type === 'purchase') {
      // Match backend patterns exactly
      if (parsed.recipient && parsed.amount && parsed.pin) {
        // Pattern 1: purchase_RECIPIENT_AMOUNT_PIN_TIMESTAMP
        newSessionId = `purchase_${parsed.recipient}_${parsed.amount}_${parsed.pin}_${timestamp}`;
      } else if (parsed.amount && parsed.pin) {
        // Pattern 2: purchase_AMOUNT_PIN_TIMESTAMP
        newSessionId = `purchase_${parsed.amount}_${parsed.pin}_${timestamp}`;
      } else if (parsed.amount) {
        // Pattern 3: purchase_AMOUNT_TIMESTAMP
        newSessionId = `purchase_${parsed.amount}_${timestamp}`;
      }
    }

    setSessionId(newSessionId);
    setIsProcessingUSSD(true);

    try {
      // ✅ FIX: Pass deviceType = 'smartphone'
      const response = await USSDService.startSession(
        newSessionId, 
        currentSessionPhone,
        'smartphone'  // ✅ CRITICAL: Pass device type
      );
      
      setIsProcessingUSSD(false);
      setShowUSSDSheet(true);
      setUssdResponse(response.message);
      setUssdInput('');

      // Auto-register on wallet creation
      if (response.message.includes('✅ Wallet Created') ||
          response.message.includes('Wallet Created')) {
        PhoneManager.registerPhone(currentSessionPhone);
        console.log('🎉 Phone registered:', currentSessionPhone);
      }

      // Auto-close on end
      if (response.end) {
        setTimeout(() => {
          setShowUSSDSheet(false);
          resetSession();
        }, 3000);
      }

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
      const response = await USSDService.continueSession(sessionId, sessionPhoneNumber, input);
      setUssdResponse(response.message);
      setUssdInput('');

      // Auto-register on wallet creation/linking
      if (response.message.includes('✅ Wallet Created') ||
          response.message.includes('Wallet Created') ||
          response.message.includes('✅ Wallet Linked')) {
        PhoneManager.registerPhone(sessionPhoneNumber);
        console.log('🎉 Phone registered:', sessionPhoneNumber);
      }

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

  const renderHomeScreen = () => (
    <div className="samsung-screen">
      <div className="samsung-home">
        <div className="samsung-time-widget">
          <div className="samsung-time">{formatTime(currentTime)}</div>
          <div className="samsung-date">{formatDate(currentTime)}</div>
        </div>
        <div className="samsung-app-grid">
          <div className="app-grid-row">
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
        <div className="samsung-dialer-header">
          <h2>Phone</h2>
          <div className="samsung-header-actions">
            <span className="samsung-search-icon">🔍</span>
            <span className="samsung-menu-icon">⋮</span>
          </div>
        </div>

        <div className="samsung-number-area">
          <div className="samsung-dialed-number">{dialedNumber || ' '}</div>
          <button
            className="samsung-add-contact"
            style={{ opacity: dialedNumber ? 1 : 0.35 }}
          >
            + Add to Contacts
          </button>
        </div>

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

        {isProcessingUSSD && (
          <div className="samsung-ussd-toast">
            <div className="samsung-toast-content">
              <div className="samsung-spinner" />
              <span className="samsung-toast-text">USSD code running...</span>
            </div>
          </div>
        )}

        {showUSSDSheet && (
          <div className="samsung-ussd-overlay">
            <div className="samsung-ussd-sheet">
              <div className="samsung-sheet-header">
                <h3>USSD</h3>
              </div>
              <div className="samsung-sheet-content">
                <pre className="samsung-ussd-message">{ussdResponse}</pre>
                <input
                  className="samsung-ussd-input"
                  type={isPinStep ? 'password' : 'text'}
                  inputMode={isPinStep ? 'numeric' : 'text'}
                  pattern={isPinStep ? '\\d*' : undefined}
                  maxLength={isPinStep ? 6 : 30}
                  autoComplete="off"
                  spellCheck={false}
                  value={ussdInput}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (isPinStep) {
                      const digits = val.replace(/\D/g, '').slice(0, 6);
                      setUssdInput(digits);
                    } else {
                      setUssdInput(val);
                    }
                  }}
                  onPaste={(e) => {
                    if (isPinStep) e.preventDefault();
                  }}
                  placeholder={isPinStep ? 'Enter PIN (4-6 digits)' : 'Enter your response'}
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
          <div style={{
            marginTop: '16px',
            padding: '12px',
            backgroundColor: '#f0f0f0',
            borderRadius: '8px',
            fontSize: '0.85rem'
          }}>
            <strong>Backend Status:</strong><br/>
            API URL: {process.env.REACT_APP_API_URL || 'http://localhost:3002'}<br/>
            Device Type: <strong>Smartphone</strong> ✅<br/>
            <em>Try dialing *789# to test wallet linking</em>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="samsung-frame">
      <div className="samsung-device">
        <div className="samsung-punch-hole" />
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

        {currentScreen === 'home' && renderHomeScreen()}
        {currentScreen === 'dialer' && renderDialerScreen()}
        {currentScreen === 'messages' && renderMessagesScreen()}

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
