import React from 'react';
import '../styles/PhoneScreen.css';

interface PhoneScreenProps {
  text: string;
  loading?: boolean;
}

const PhoneScreen: React.FC<PhoneScreenProps> = ({ text, loading = false }) => {
  // Truncate to 160 characters (SMS limit)
  const displayText = text.slice(0, 160);
  
  return (
    <div className={`phone-screen ${loading ? 'loading' : ''}`}>
      <pre className="screen-text">{displayText}</pre>
      {loading && (
        <div className="loading-indicator">
          <span className="loading-dots">●●●</span>
        </div>
      )}
    </div>
  );
};

export default PhoneScreen;
