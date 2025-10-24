import { USSDResponse } from '../types';

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:3002';

export class USSDService {
  /**
   * Start a new USSD session
   * @param sessionId - Unique session identifier
   * @param phoneNumber - User's phone number
   * @param deviceType - Device type ('basic' or 'smartphone')
   */
  static async startSession(
    sessionId: string,
    phoneNumber: string,
    deviceType?: string
  ): Promise<USSDResponse> {
    console.log('🔗 API Call - Start Session:', {
      sessionId: sessionId.slice(-8),
      phoneNumber,
      deviceType
    });

    try {
      const response = await fetch(`${API_BASE}/api/ussd/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          sessionId,
          phoneNumber,
          deviceType
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      console.log('📥 API Response - Start Session:', result);
      return result;
    } catch (error) {
      console.error('❌ Start Session Error:', error);
      throw new Error(`Connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Continue an existing USSD session
   * @param sessionId - Session identifier
   * @param phoneNumber - User's phone number
   * @param text - User input text
   */
  static async continueSession(
    sessionId: string,
    phoneNumber: string,
    text: string
  ): Promise<USSDResponse> {
    console.log('🔗 API Call - Continue Session:', {
      sessionId: sessionId.slice(-8),
      phoneNumber,
      text
    });

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
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      console.log('📥 API Response - Continue Session:', result);
      return result;
    } catch (error) {
      console.error('❌ Continue Session Error:', error);
      throw new Error(`Transaction failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * End a USSD session
   * @param sessionId - Session identifier
   */
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

      console.log('✅ Session ended successfully');
    } catch (error) {
      console.log('⚠️ End Session Error (non-critical):', error);
      // Don't throw - ending session errors are not critical
    }
  }

  /**
   * Check wallet connection status
   * @param connectionId - Wallet connection identifier
   */
  static async checkWalletConnectionStatus(connectionId: string): Promise<any> {
    console.log('🔗 API Call - Check Wallet Status:', { connectionId: connectionId.slice(-8) });

    try {
      const response = await fetch(`${API_BASE}/api/wallet/status/${connectionId}`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      console.log('📥 API Response - Wallet Status:', result);
      return result;
    } catch (error) {
      console.error('❌ Check Wallet Status Error:', error);
      throw new Error(`Status check failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Complete wallet connection (callback from wallet app)
   * @param connectionId - Wallet connection identifier
   * @param walletAddress - Solana wallet public key
   * @param signature - Optional signature for verification
   * @param message - Optional message that was signed
   */
  static async completeWalletConnection(
    connectionId: string,
    walletAddress: string,
    signature?: string,
    message?: string
  ): Promise<any> {
    console.log('🔗 API Call - Complete Wallet Connection:', {
      connectionId: connectionId.slice(-8),
      wallet: walletAddress.substring(0, 8) + '...'
    });

    try {
      const response = await fetch(`${API_BASE}/api/ussd/wallet/callback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          connectionId,
          walletAddress,
          signature,
          message
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      console.log('📥 API Response - Wallet Connection Complete:', result);
      return result;
    } catch (error) {
      console.error('❌ Complete Wallet Connection Error:', error);
      throw new Error(`Wallet connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get all active wallet connections (admin/debug)
   */
  static async getAllWalletConnections(): Promise<any> {
    console.log('🔗 API Call - Get All Wallet Connections');

    try {
      const response = await fetch(`${API_BASE}/api/wallet/connections`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      console.log('📥 API Response - All Connections:', result);
      return result;
    } catch (error) {
      console.error('❌ Get All Connections Error:', error);
      throw new Error(`Failed to get connections: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}
