import React, { useState, useCallback, useEffect } from 'react';
import PhoneFrame from './components/PhoneFrame';
import DeviceToggle from './components/DeviceToggle';
import AndroidFrame from './components/AndroidFrame';
import SmartphoneOverlay from './components/SmartphoneOverlay';
import { USSDService } from './services/USSDService';
import { PhoneManager } from './services/PhoneManager';
import { MessageFormatter } from './services/MessageFormatter';
import { AppState, KeypadKey, USSDSession, DeviceType, PhoneProfile } from './types';
import './styles/App.css';

const App: React.FC = () => {
  const [deviceType, setDeviceType] = useState<DeviceType>('basic');
  const [phoneProfile, setPhoneProfile] = useState<PhoneProfile | null>(null);
  const [appState, setAppState] = useState<AppState>('idle');
  const [dialInput, setDialInput] = useState('');
  const [ussdResponse, setUssdResponse] = useState('');
  const [session, setSession] = useState<USSDSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSmartphoneOverlay, setShowSmartphoneOverlay] = useState(false);

  // Initialize phone profile on device change
  useEffect(() => {
    const profile = PhoneManager.createPhoneProfile(deviceType);
    setPhoneProfile(profile);
    resetToIdle();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceType]);

  // Detect wallet connection trigger in USSD response
  useEffect(() => {
    if (ussdResponse.includes('[WALLET_CONNECT:')) {
      const match = ussdResponse.match(/\[WALLET_CONNECT:([a-f0-9]+)\]/);
      if (match) {
        const connectionId = match[1];
        console.log('🔗 Detected wallet connection trigger:', connectionId);
        
        // Clean the message for display (remove the marker)
        const cleanMessage = ussdResponse.replace(/\[WALLET_CONNECT:[a-f0-9]+\]/, '').trim();
        setUssdResponse(cleanMessage);
        
        // Trigger wallet connection after brief delay
        setTimeout(() => {
          handleWalletConnection(connectionId);
        }, 1500);
      }
    }
  }, [ussdResponse]);

  const resetToIdle = useCallback(() => {
    setAppState('idle');
    setDialInput('');
    setUssdResponse('');
    setSession(null);
    setError(null);
    setLoading(false);
    setShowSmartphoneOverlay(false);
  }, []);

  const handleDeviceToggle = (newDeviceType: DeviceType) => {
    setDeviceType(newDeviceType);
  };

  const handleWalletConnection = async (connectionId: string) => {
    console.log('🔗 Initiating mock wallet connection for:', connectionId);
    
    // Mock wallet address
    const mockWalletAddress = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
    
    try {
      // Show "Opening wallet..." message
      setUssdResponse('🔗 Opening wallet app...\n\nPlease approve connection in your wallet');
      
      // Simulate user approval delay (2 seconds)
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      setUssdResponse('✅ Wallet approved\n\nLinking to phone number...');
      
      // Call backend webhook
      const response = await fetch('http://localhost:3002/api/wallet/callback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          connectionId: connectionId,
          walletAddress: mockWalletAddress,
          signature: null,
          message: null
        })
      });

      if (!response.ok) {
        throw new Error(`Wallet connection failed: ${response.statusText}`);
      }

      const result = await response.json();
      
      if (result.success) {
        console.log('✅ Wallet linked successfully:', result);
        
        // Register phone as linked
        if (phoneProfile) {
          PhoneManager.registerPhone(phoneProfile.number);
        }
        
        // Show success message
        setUssdResponse(
          `✅ Wallet Linked!\n\n` +
          `Solana wallet linked\n` +
          `Phone: ${result.phone}\n` +
          `Wallet: ${mockWalletAddress.substring(0, 4)}...${mockWalletAddress.slice(-4)}\n\n` +
          `Dial *789*AMOUNT*PIN# to transact`
        );
        
        // Auto-close after 4 seconds
        setTimeout(() => {
          resetToIdle();
        }, 4000);
      } else {
        throw new Error(result.error || 'Wallet linking failed');
      }
    } catch (err: any) {
      console.error('❌ Wallet connection error:', err);
      setError(err.message);
      setUssdResponse(`❌ Wallet linking failed\n\n${err.message}\n\nPress End to exit`);
    }
  };

  const handleAndroidDial = async (code: string) => {
    // Generate new phone number for registration flows
    let currentProfile = phoneProfile;
    if (code === '*789#') {
      currentProfile = PhoneManager.createPhoneProfile(deviceType);
      setPhoneProfile(currentProfile);
      console.log('📱 Generated new phone for registration:', currentProfile.displayNumber);
    }

    if (!currentProfile) return;

    console.log('📞 Android Dialing:', code, 'on', currentProfile.displayNumber);
    setDialInput(code);
    setAppState('dialing');
    setLoading(true);
    setError(null);
    setShowSmartphoneOverlay(true);

    try {
      let sessionId = '';

      if (code === '*789#') {
        sessionId = `registration_${Date.now()}`;
        console.log('📝 Starting Registration Flow');
      } else {
        // Parse purchase patterns - ALL use 'code' parameter
        let match;

        // Pattern 2: *789*RECIPIENT*AMOUNT*PIN#
        match = code.match(/^\*789\*(\d{11})\*(\d+)\*(\d{4,6})#$/);
        if (match) {
          const [, recipient, amount, pin] = match;
          if (!PhoneManager.isRegistered(currentProfile.number)) {
            throw new Error(`Phone ${currentProfile.displayNumber} not registered. Dial *789# first.`);
          }
          sessionId = `purchase_${recipient}_${amount}_${pin}_${Date.now()}`;
          console.log('📤 Pattern 2: Send to', recipient, 'Amount:', amount);
        }

        // Pattern 1: *789*AMOUNT*PIN# - FIXED: uses 'code' not 'dialInput'
        if (!sessionId) {
          match = code.match(/^\*789\*(\d+)\*(\d{4,6})#$/);
          if (match) {
            const [, amount, pin] = match;
            if (!PhoneManager.isRegistered(currentProfile.number)) {
              throw new Error(`Phone ${currentProfile.displayNumber} not registered. Dial *789# first.`);
            }
            sessionId = `purchase_${amount}_${pin}_${Date.now()}`;
            console.log('💰 Pattern 1: Buy for self, Amount:', amount);
          }
        }

        // Pattern 3: *789*AMOUNT#
        if (!sessionId) {
          match = code.match(/^\*789\*(\d+)#$/);
          if (match) {
            const [, amount] = match;
            if (!PhoneManager.isRegistered(currentProfile.number)) {
              throw new Error(`Phone ${currentProfile.displayNumber} not registered. Dial *789# first.`);
            }
            sessionId = `purchase_${amount}_${Date.now()}`;
            console.log('📋 Pattern 3: Fallback flow, Amount:', amount);
          }
        }

        if (!sessionId) {
          throw new Error('Invalid USSD code. Use *789# to register or *789*AMOUNT*PIN# to purchase.');
        }
      }

      // ✅ PASS deviceType to backend
      const response = await USSDService.startSession(sessionId, currentProfile.number, deviceType);
      const formattedMessage = MessageFormatter.formatMessage(response.message, deviceType);

      setSession({
        sessionId,
        phoneNumber: currentProfile.number,
        stage: 'started',
        flowType: sessionId.includes('registration') ? 'registration' : 'purchase',
        createdAt: Date.now()
      });

      setUssdResponse(formattedMessage.content);
      setAppState('ussd_active');
      setDialInput('');
    } catch (err: any) {
      console.error('❌ Dial Error:', err);
      setError(err.message);
      setAppState('idle');
      setDialInput('');
      setShowSmartphoneOverlay(false);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = async (key: KeypadKey) => {
    console.log('🔘 Key Pressed:', key, '| App State:', appState, '| Device:', deviceType);
    
    if (loading) return;

    if (key === 'End') {
      if (session?.sessionId) {
        await USSDService.endSession(session.sessionId);
      }
      resetToIdle();
      return;
    }

    if (appState === 'idle' || appState === 'dialing') {
      // DIALING MODE
      if (key === 'Call') {
        await handleDial();
      } else if (key === '#') {
        setDialInput(prev => prev + '#');
        setAppState('dialing');
      } else if (key === '*') {
        setDialInput(prev => prev + '*');
        setAppState('dialing');
      } else if (['0','1','2','3','4','5','6','7','8','9'].includes(key)) {
        setDialInput(prev => prev + key);
        setAppState('dialing');
      }
    } else if (appState === 'ussd_active') {
      // USSD SESSION MODE
      if (key === 'Call') {
        await handleContinue();
      } else if (['0','1','2','3','4','5','6','7','8','9'].includes(key)) {
        if (isPinScreen()) {
          if (dialInput.length < 6) {
            setDialInput(prev => prev + key);
          }
        } else if (isPhoneNumberScreen()) {
          if (dialInput.length < 11) {
            setDialInput(prev => prev + key);
          }
        } else {
          setDialInput(key);
        }
      }
    }
  };

  const isPinScreen = (): boolean => {
    return ussdResponse.includes('PIN:') ||
           ussdResponse.includes('Enter PIN (4-6 digits)') ||
           ussdResponse.includes('Create PIN (4-6 digits)') ||
           ussdResponse.includes('Re-enter your PIN');
  };

  const isPhoneNumberScreen = (): boolean => {
    return ussdResponse.includes('Enter Phone Number') ||
           ussdResponse.includes('Number:');
  };

  const handleDial = async () => {
    if (!dialInput) return;

    let currentProfile = phoneProfile;
    if (dialInput === '*789#') {
      currentProfile = PhoneManager.createPhoneProfile(deviceType);
      setPhoneProfile(currentProfile);
      console.log('📱 Generated new phone for registration:', currentProfile.displayNumber);
    }

    if (!currentProfile) return;

    console.log('📞 Dialing:', dialInput, 'on', currentProfile.displayNumber);
    setLoading(true);
    setError(null);

    if (deviceType === 'smartphone') {
      setShowSmartphoneOverlay(true);
    }

    try {
      let sessionId = '';

      if (dialInput === '*789#') {
        sessionId = `registration_${Date.now()}`;
        console.log('📝 Starting Registration Flow');
      } else {
        let match;

        // Pattern 2: *789*RECIPIENT*AMOUNT*PIN#
        match = dialInput.match(/^\*789\*(\d{11})\*(\d+)\*(\d{4,6})#$/);
        if (match) {
          const [, recipient, amount, pin] = match;
          if (!PhoneManager.isRegistered(currentProfile.number)) {
            throw new Error(`Phone ${currentProfile.displayNumber} not registered. Dial *789# first.`);
          }
          sessionId = `purchase_${recipient}_${amount}_${pin}_${Date.now()}`;
          console.log('📤 Pattern 2: Send to', recipient, 'Amount:', amount);
        }

        // Pattern 1: *789*AMOUNT*PIN# - ALL use dialInput here (correct for handleDial)
        if (!sessionId) {
          match = dialInput.match(/^\*789\*(\d+)\*(\d{4,6})#$/);
          if (match) {
            const [, amount, pin] = match;
            if (!PhoneManager.isRegistered(currentProfile.number)) {
              throw new Error(`Phone ${currentProfile.displayNumber} not registered. Dial *789# first.`);
            }
            sessionId = `purchase_${amount}_${pin}_${Date.now()}`;
            console.log('💰 Pattern 1: Buy for self, Amount:', amount);
          }
        }

        // Pattern 3: *789*AMOUNT#
        if (!sessionId) {
          match = dialInput.match(/^\*789\*(\d+)#$/);
          if (match) {
            const [, amount] = match;
            if (!PhoneManager.isRegistered(currentProfile.number)) {
              throw new Error(`Phone ${currentProfile.displayNumber} not registered. Dial *789# first.`);
            }
            sessionId = `purchase_${amount}_${Date.now()}`;
            console.log('📋 Pattern 3: Fallback flow, Amount:', amount);
          }
        }

        if (!sessionId) {
          throw new Error('Invalid USSD code. Use *789# to register or *789*AMOUNT*PIN# to purchase.');
        }
      }

      // ✅ PASS deviceType to backend
      const response = await USSDService.startSession(sessionId, currentProfile.number, deviceType);
      const formattedMessage = MessageFormatter.formatMessage(response.message, deviceType);

      setSession({
        sessionId,
        phoneNumber: currentProfile.number,
        stage: 'started',
        flowType: sessionId.includes('registration') ? 'registration' : 'purchase',
        createdAt: Date.now()
      });

      setUssdResponse(formattedMessage.content);
      setAppState('ussd_active');
      setDialInput('');
    } catch (err: any) {
      console.error('❌ Dial Error:', err);
      setError(err.message);
      setAppState('idle');
      setDialInput('');
      setShowSmartphoneOverlay(false);
    } finally {
      setLoading(false);
    }
  };

  const handleContinue = async () => {
    if (!dialInput || !session || !phoneProfile) return;

    console.log('➡️ Continue with:', dialInput);
    setLoading(true);
    setError(null);

    try {
      // Prevent wallet linking on basic phone
      if (deviceType === 'basic' && dialInput === '2' &&
          ussdResponse.includes('Link Existing')) {
        throw new Error('Wallet linking requires a smartphone. Please use the Android device type or choose option 1 for new wallet.');
      }

      const response = await USSDService.continueSession(
        session.sessionId,
        phoneProfile.number,
        dialInput
      );

      const formattedMessage = MessageFormatter.formatMessage(response.message, deviceType);
      setUssdResponse(formattedMessage.content);
      setDialInput('');

      // Register phone on successful wallet creation/linking
      if (response.message.includes('✅ Wallet Created') ||
          response.message.includes('Wallet Created') ||
          response.message.includes('✅ Wallet Linked')) {
        PhoneManager.registerPhone(phoneProfile.number);
        console.log('🎉 Phone registered:', phoneProfile.displayNumber);
      }

      if (response.end) {
        setTimeout(() => {
          resetToIdle();
        }, 3000);
      }
    } catch (err: any) {
      console.error('❌ Continue Error:', err);
      setError(err.message);
      setDialInput('');
    } finally {
      setLoading(false);
    }
  };

  const getScreenText = (): string => {
    if (loading) {
      return 'Please wait...\nConnecting to OUH!\n\n●●●';
    }

    if (error) {
      return `Error:\n${error}\n\nPress End to clear`;
    }

    if (appState === 'idle') {
      const time = new Date().toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit'
      });
      return `${time}\n\nMTN Nigeria\nWelcome!\n\n\n\n`;
    }

    if (appState === 'dialing') {
      return dialInput;
    }

    if (appState === 'ussd_active') {
      let inputDisplay = '';
      if (dialInput) {
        if (isPinScreen()) {
          const masked = '*'.repeat(dialInput.length);
          const progress = `(${dialInput.length}/6)`;
          inputDisplay = `\n> ${masked} ${progress}`;
        } else if (isPhoneNumberScreen()) {
          inputDisplay = `\n> ${dialInput}`;
        } else {
          inputDisplay = `\n> ${dialInput}`;
        }
      }
      return `${ussdResponse}${inputDisplay}`;
    }

    return '';
  };

  const getStatusText = (): string => {
    const time = new Date().toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit'
    });

    switch (appState) {
      case 'idle':
        const deviceName = deviceType === 'basic' ? 'Nokia' : 'Android';
        const charLimit = PhoneManager.getCharacterLimit(deviceType);
        return `${deviceName} | ${charLimit}chars | ${time}`;
      case 'dialing':
        return `Dialing... | ${time}`;
      case 'ussd_active':
        const inputType = isPinScreen() ? 'PIN' :
                         isPhoneNumberScreen() ? 'Phone' : 'Menu';
        return `USSD Active | ${inputType} | ${session?.sessionId.slice(-6) || ''}`;
      default:
        return `Ready | ${time}`;
    }
  };

  return (
    <div className="app">
      <div className="app-container">
        <h1 className="app-title">OUH! Dual-Device USSD Simulator</h1>
        <p className="app-subtitle">Experience crypto wallets on both basic phones and smartphones</p>
        
        <DeviceToggle
          deviceType={deviceType}
          onToggle={handleDeviceToggle}
        />

        {deviceType === 'basic' ? (
          <PhoneFrame
            screenText={getScreenText()}
            statusText={getStatusText()}
            loading={loading}
            onKeyPress={handleKeyPress}
          />
        ) : (
          <AndroidFrame
            phoneNumber={phoneProfile?.displayNumber || ''}
            isRegistered={phoneProfile ? PhoneManager.isRegistered(phoneProfile.number) : false}
            onDialClick={handleAndroidDial}
          />
        )}

        {showSmartphoneOverlay && (
          <SmartphoneOverlay
            screenText={getScreenText()}
            statusText={getStatusText()}
            loading={loading}
            onKeyPress={handleKeyPress}
            onClose={() => setShowSmartphoneOverlay(false)}
          />
        )}

        <div className="demo-info">
          <p>🔄 Device: {deviceType === 'basic' ? 'Nokia Feature Phone' : 'Android Smartphone'}</p>
          <p>📱 Current: {phoneProfile?.displayNumber} ({PhoneManager.isRegistered(phoneProfile?.number || '') ? 'Registered' : 'Unregistered'})</p>
          <p>📊 Char Limit: {PhoneManager.getCharacterLimit(deviceType)} characters</p>
        </div>
      </div>
    </div>
  );
};

export default App;
