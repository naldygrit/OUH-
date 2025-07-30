use anchor_lang::prelude::*;

declare_id!("74D7UqGmgBaod2jTaKotYF8rDNd3xWv9eo43Gt5iHKxS");

#[program]
pub mod ouh {
    use super::*;
    // Day 0 entry points (to be implemented in Day 1)
}

pub const USER_SEED: &[u8] = b"user";
pub const TRANSACTION_SEED: &[u8] = b"transaction"; 
pub const CONFIG_SEED: &[u8] = b"config";

#[account]
pub struct UserAccount {
    pub phone_number: [u8; 14],
    pub wallet: Pubkey,
    pub pin_hash: [u8; 32],
    pub total_volume: u64,
    pub registered_at: i64,
    pub status: UserStatus,
}

#[account]
pub struct TransactionAccount {
    pub tx_id: [u8; 16],
    pub user_phone: [u8; 14],
    pub tx_type: TransactionType,
    pub amount_ngn: u64,
    pub amount_usdc: Option<u64>,
    pub status: TransactionStatus,
    pub timestamp: i64,
    pub fee: u64,
}

#[account]
pub struct Config {
    pub admin: Pubkey,
    pub crypto_fee_bps: u16,
    pub airtime_fee_bps: u16,
    pub min_limit: u64,
    pub max_limit: u64,
    pub paused: bool,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum UserStatus {
    Active,
    Suspended,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum TransactionType {
    Crypto,
    Airtime,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum TransactionStatus {
    Pending,
    Completed,
    Failed,
}

impl UserAccount {
    pub const LEN: usize = 8 + 14 + 32 + 32 + 8 + 8 + 1;
}

impl TransactionAccount {
    pub const LEN: usize = 8 + 16 + 14 + 1 + 8 + 9 + 1 + 8 + 8;
}

impl Config {
    pub const LEN: usize = 8 + 32 + 2 + 2 + 8 + 8 + 1;
}

#[error_code]
pub enum OuhError {
    #[msg("Invalid phone number format")]
    InvalidPhoneFormat,
    #[msg("Transaction limit out of bounds")]
    TransactionLimitOutOfBounds,
    #[msg("Contract paused")]
    ContractPaused,
    #[msg("User suspended")]
    UserSuspended,
}
