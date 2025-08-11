import { USSDResponse } from '../types';

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:3002';

export class USSDService {
  static async startSession(sessionId: string, phoneNumber: string): Promise<USSDResponse> {
    console.log('🔗 API Call - Start Session:', { sessionId: sessionId.slice(-8), phoneNumber });
    
    try {
      const response = await fetch(`${API_BASE}/api/ussd/start`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ sessionId, phoneNumber })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const result = await response.json();
      console.log('📥 API Response - Start Session:', result);
      return result;
      
    } catch (error) {
      console.error('❌ Start Session Error:', error);
      throw new Error(`Connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  static async continueSession(sessionId: string, phoneNumber: string, text: string): Promise<USSDResponse> {
    console.log('🔗 API Call - Continue Session:', { sessionId: sessionId.slice(-8), phoneNumber, text });
    
    try {
      const response = await fetch(`${API_BASE}/api/ussd/continue`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ sessionId, phoneNumber, text })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const result = await response.json();
      console.log('📥 API Response - Continue Session:', result);
      return result;
      
    } catch (error) {
      console.error('❌ Continue Session Error:', error);
      throw new Error(`Transaction failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  static async endSession(sessionId: string): Promise<void> {
    console.log('🔗 API Call - End Session:', { sessionId: sessionId.slice(-8) });
    
    try {
      await fetch(`${API_BASE}/api/ussd/end`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ sessionId })
      });
      
    } catch (error) {
      console.log('⚠️ End Session Error (non-critical):', error);
      // Don't throw - ending session errors are not critical
    }
  }
}
