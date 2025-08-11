import React from 'react';
import { KeypadKey } from '../types';
import '../styles/Keypad.css';

interface KeypadProps {
  onKeyPress: (key: KeypadKey) => void;
  disabled?: boolean;
}

const Keypad: React.FC<KeypadProps> = ({ onKeyPress, disabled = false }) => {
  const handleKeyPress = (key: KeypadKey) => {
    if (!disabled) {
      onKeyPress(key);
    }
  };

  return (
    <div className={`keypad ${disabled ? 'disabled' : ''}`}>
      {/* Navigation Cross - Row 1: OK, UP, BACK */}
      <div className="keypad-row">
        <button
          className="keypad-button nav-button ok-button"
          onClick={() => handleKeyPress('Call')}
          disabled={disabled}
          title="Confirm/Proceed"
        >
          <span className="nav-text">OK</span>
        </button>
        <button
          className="keypad-button nav-button up-button"
          onClick={() => handleKeyPress('Call')}
          disabled={disabled}
          title="Navigate Up"
        >
          <span className="nav-text">▲</span>
        </button>
        <button
          className="keypad-button nav-button back-button"
          onClick={() => handleKeyPress('End')}
          disabled={disabled}
          title="Back/Cancel"
        >
          <span className="nav-text">BACK</span>
        </button>
      </div>

      {/* Navigation Cross - Row 2: LEFT, MENU, RIGHT */}
      <div className="keypad-row">
        <button
          className="keypad-button nav-button left-button"
          onClick={() => handleKeyPress('Call')}
          disabled={disabled}
          title="Navigate Left"
        >
          <span className="nav-text">◄</span>
        </button>
        <button
          className="keypad-button menu-button"
          onClick={() => handleKeyPress('Call')}
          disabled={disabled}
          title="Main Menu"
        >
          <span className="menu-text">MENU</span>
        </button>
        <button
          className="keypad-button nav-button right-button"
          onClick={() => handleKeyPress('Call')}
          disabled={disabled}
          title="Navigate Right"
        >
          <span className="nav-text">►</span>
        </button>
      </div>

      {/* Action Row: CALL, DOWN, END */}
      <div className="keypad-row">
        <button
          className="keypad-button call-button"
          onClick={() => handleKeyPress('Call')}
          disabled={disabled}
          title="Make Call/Dial"
        >
          <span className="call-icon">📞</span>
          <span className="key-letters">CALL</span>
        </button>
        <button
          className="keypad-button nav-button down-button"
          onClick={() => handleKeyPress('Call')}
          disabled={disabled}
          title="Navigate Down"
        >
          <span className="nav-text">▼</span>
        </button>
        <button
          className="keypad-button end-button"
          onClick={() => handleKeyPress('End')}
          disabled={disabled}
          title="End Call/Exit"
        >
          <span className="end-icon">📵</span>
          <span className="key-letters">END</span>
        </button>
      </div>

      {/* Number Pad Rows */}
      <div className="keypad-row">
        <button
          className="keypad-button number-button"
          onClick={() => handleKeyPress('1')}
          disabled={disabled}
        >
          1
        </button>
        <button
          className="keypad-button number-button"
          onClick={() => handleKeyPress('2')}
          disabled={disabled}
        >
          2<span className="key-letters">ABC</span>
        </button>
        <button
          className="keypad-button number-button"
          onClick={() => handleKeyPress('3')}
          disabled={disabled}
        >
          3<span className="key-letters">DEF</span>
        </button>
      </div>

      <div className="keypad-row">
        <button
          className="keypad-button number-button"
          onClick={() => handleKeyPress('4')}
          disabled={disabled}
        >
          4<span className="key-letters">GHI</span>
        </button>
        <button
          className="keypad-button number-button"
          onClick={() => handleKeyPress('5')}
          disabled={disabled}
        >
          5<span className="key-letters">JKL</span>
        </button>
        <button
          className="keypad-button number-button"
          onClick={() => handleKeyPress('6')}
          disabled={disabled}
        >
          6<span className="key-letters">MNO</span>
        </button>
      </div>

      <div className="keypad-row">
        <button
          className="keypad-button number-button"
          onClick={() => handleKeyPress('7')}
          disabled={disabled}
        >
          7<span className="key-letters">PQRS</span>
        </button>
        <button
          className="keypad-button number-button"
          onClick={() => handleKeyPress('8')}
          disabled={disabled}
        >
          8<span className="key-letters">TUV</span>
        </button>
        <button
          className="keypad-button number-button"
          onClick={() => handleKeyPress('9')}
          disabled={disabled}
        >
          9<span className="key-letters">WXYZ</span>
        </button>
      </div>

      <div className="keypad-row">
        <button
          className="keypad-button number-button"
          onClick={() => handleKeyPress('*')}
          disabled={disabled}
        >
          *
        </button>
        <button
          className="keypad-button number-button"
          onClick={() => handleKeyPress('0')}
          disabled={disabled}
        >
          0<span className="key-letters">+</span>
        </button>
        <button
          className="keypad-button number-button"
          onClick={() => handleKeyPress('#')}
          disabled={disabled}
        >
          #
        </button>
      </div>
    </div>
  );
};

export default Keypad;
