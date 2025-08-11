import React from 'react';
import PhoneScreen from './PhoneScreen';
import Keypad from './Keypad';
import { KeypadKey } from '../types';
import '../styles/PhoneFrame.css';

interface PhoneFrameProps {
  screenText: string;
  statusText: string;
  loading: boolean;
  onKeyPress: (key: KeypadKey) => void;
}

const PhoneFrame: React.FC<PhoneFrameProps> = ({ 
  screenText, 
  statusText, 
  loading, 
  onKeyPress 
}) => {
  return (
    <div className="phone-frame">
      <div className="phone-header">
        <div className="carrier-info">
          <span className="carrier">MTN NG</span>
          <span className="signal">●●●●</span>
          <span className="battery">100%</span>
        </div>
      </div>
      
      <PhoneScreen 
        text={screenText} 
        loading={loading} 
      />
      
      <Keypad 
        onKeyPress={onKeyPress} 
        disabled={loading} 
      />
      
      <div className="phone-footer">
        <span className="status">{statusText}</span>
      </div>
    </div>
  );
};

export default PhoneFrame;

