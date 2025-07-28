OUH!

USSD-based crypto onramp via Nigeria's VTU infrastructure.

Problem

Traditional crypto onramps: 7 steps, 2-5 days, 15+ touchpoints.
Current solution for 200M+ Nigerians: None that works.

Solution
Dial `*789*AMOUNT#` → Choose crypto or airtime → Done.
3 steps, 30 seconds, 1 touchpoint.

Why This Works
- Leverages ₦3+ trillion VTU infrastructure Nigerians already trust
- Phone number = wallet address (no setup required)
- Same USSD experience they use daily for airtime
- Works on any phone, no internet/app needed

Technical Architecture
- Solana smart contracts for wallet management
- Pyth Network for real-time FX rates
- VTU API integration for payment processing
- SMS confirmations for security

Development
```bash
anchor build
anchor test
anchor deploy


Status
Week 1: Smart contract development
Target: Colosseum Eternal submission

*Built for the 200M+ Nigerians who buy airtime daily but can't access crypto*
