import { PhoneProfile, DeviceType } from '../types';

// Nigerian phone number prefixes (realistic)
const NIGERIAN_PREFIXES = [
  '0803', '0806', '0813', '0814', '0816', '0903', '0906', // MTN
  '0805', '0807', '0815', '0905', '0915', '0708', // Globacom
  '0802', '0808', '0812', '0901', '0904', '0909', '0918', // Airtel
  '0809', '0817', '0818', '0819', '0909', '0908' // 9mobile
];

export class PhoneManager {
  private static registeredNumbers: Set<string> = new Set();
  private static phoneProfiles: Map<string, PhoneProfile> = new Map();

  static generateRandomNumber(): string {
    const prefix = NIGERIAN_PREFIXES[Math.floor(Math.random() * NIGERIAN_PREFIXES.length)];
    const suffix = Math.floor(Math.random() * 10000000).toString().padStart(7, '0');
    return `${prefix}${suffix}`;
  }

  static createPhoneProfile(deviceType: DeviceType): PhoneProfile {
    const number = this.generateRandomNumber();
    const displayNumber = number;
    
    const profile: PhoneProfile = {
      number: `+234${number.slice(1)}`, // Convert to international format
      displayNumber,
      registered: false,
      deviceType,
      balance: 0
    };

    this.phoneProfiles.set(profile.number, profile);
    console.log('📱 Generated phone profile:', profile);
    
    return profile;
  }

  static registerPhone(phoneNumber: string): void {
    this.registeredNumbers.add(phoneNumber);
    const profile = this.phoneProfiles.get(phoneNumber);
    if (profile) {
      profile.registered = true;
      profile.walletAddress = profile.displayNumber;
      profile.balance = 15.76; // Demo starting balance
    }
    console.log('✅ Phone registered:', phoneNumber);
  }

  static isRegistered(phoneNumber: string): boolean {
    return this.registeredNumbers.has(phoneNumber);
  }

  static getProfile(phoneNumber: string): PhoneProfile | null {
    return this.phoneProfiles.get(phoneNumber) || null;
  }

  static canLinkWallet(deviceType: DeviceType): boolean {
    return deviceType === 'smartphone';
  }

  static getCharacterLimit(deviceType: DeviceType): number {
    return deviceType === 'basic' ? 182 : 160;
  }
}
