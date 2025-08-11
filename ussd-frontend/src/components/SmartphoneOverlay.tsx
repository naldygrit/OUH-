import React from 'react';
import { KeypadKey } from '../types';
import '../styles/SmartphoneOverlay.css';

interface SmartphoneOverlayProps {
  screenText: string;
  statusText: string;
  loading: boolean;
  onKeyPress: (key: KeypadKey) => void;
  onClose: () => void;
}

const SmartphoneOverlay: React.FC<SmartphoneOverlayProps> = ({
  screenText,
  statusText,
  loading,
  onKeyPress,
  onClose
}) => {
  const numberKeys: KeypadKey[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];

  return (
    <div className="smartphone-overlay">
      <div className="overlay-header">
        <div className="operator-info">
          <span className="operator">MTN</span>
          <span className="ussd-code">USSD</span>
        </div>
        <button className="close-button" onClick={onClose}>×</button>
      </div>

      <div className="ussd-content">
        <pre className="ussd-text">{screenText}</pre>
        {loading && <div className="loading-spinner">●●●</div>}
      </div>

      <div className="input-section">
        <div className="number-grid">
          {numberKeys.map(key => (
            <button
              key={key}
              className="number-key"
              onClick={() => onKeyPress(key)}
              disabled={loading}
            >
              {key}
            </button>
          ))}
        </div>

        <div className="action-buttons">
          <button
            className="action-btn call-btn"
            onClick={() => onKeyPress('Call')}
            disabled={loading}
          >
            Send
          </button>
          <button
            className="action-btn end-btn"
            onClick={() => onKeyPress('End')}
            disabled={loading}
          >
            Cancel
          </button>
        </div>
      </div>

      <div className="status-bar">
        <span>{statusText}</span>
      </div>
    </div>
  );
};

export default SmartphoneOverlay;
