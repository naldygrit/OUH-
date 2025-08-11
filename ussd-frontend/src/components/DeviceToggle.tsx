import React from 'react';
import { DeviceType } from '../types';
import '../styles/DeviceToggle.css';

interface DeviceToggleProps {
  deviceType: DeviceType;
  onToggle: (type: DeviceType) => void;
}

const DeviceToggle: React.FC<DeviceToggleProps> = ({ deviceType, onToggle }) => {
  return (
    <div className="device-toggle">
      <div className="toggle-header">
        <h3>Device Type</h3>
        <p>Choose your phone type for different USSD experience</p>
      </div>
      
      <div className="toggle-container">
        <button
          className={`toggle-button ${deviceType === 'basic' ? 'active' : ''}`}
          onClick={() => onToggle('basic')}
        >
          <div className="device-icon">📱</div>
          <div className="device-info">
            <span className="device-name">Basic Phone</span>
            <span className="device-desc">Feature Phone</span>
          </div>
        </button>
        
        <button
          className={`toggle-button ${deviceType === 'smartphone' ? 'active' : ''}`}
          onClick={() => onToggle('smartphone')}
        >
          <div className="device-icon">📲</div>
          <div className="device-info">
            <span className="device-name">Smartphone</span>
            <span className="device-desc">Android Device</span>
          </div>
        </button>
      </div>
    </div>
  );
};

export default DeviceToggle;
