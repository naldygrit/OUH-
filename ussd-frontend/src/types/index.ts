export interface USSDResponse {
  message: string;
  end: boolean;
  sessionId?: string;
  error?: string;
}

export interface USSDSession {
  sessionId: string;
  phoneNumber: string;
  stage: string;
  flowType: 'registration' | 'purchase' | 'idle';
  createdAt: number;
}

export type AppState = 'idle' | 'dialing' | 'ussd_active';
export type DeviceType = 'basic' | 'smartphone';
export type KeypadKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '*' | '#' | 'Call' | 'End';

export interface PhoneProfile {
  number: string;
  displayNumber: string;
  registered: boolean;
  deviceType: DeviceType;
  walletAddress?: string;
  balance?: number;
}

export interface USSDMessage {
  content: string;
  truncated: boolean;
  characterCount: number;
  maxLength: number;
}
