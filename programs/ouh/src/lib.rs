use anchor_lang::prelude::*;

declare_id!("CZohQsF3D3cDDTtJnMZi9WirsknWxWyBKgHiLg5b1T8E");

#[program]
pub mod ouh {
    use super::*;
    
    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        crypto_fee_bps: u16,
        airtime_fee_bps: u16,
        min_limit: u64,
        max_limit: u64,
    ) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.admin = ctx.accounts.admin.key();
        config.crypto_fee_bps = crypto_fee_bps;
        config.airtime_fee_bps = airtime_fee_bps;
        config.min_limit = min_limit;
        config.max_limit = max_limit;
        config.paused = false;
        Ok(())
    }
    
    pub fn register_user(
        ctx: Context<RegisterUser>,
        phone_number: [u8; 14],
        pin_hash: [u8; 32],
    ) -> Result<()> {
        let user_account = &mut ctx.accounts.user_account;
        user_account.phone_number = phone_number;
        user_account.wallet = ctx.accounts.user.key();
        user_account.pin_hash = pin_hash;
        user_account.total_volume = 0;
        user_account.registered_at = Clock::get()?.unix_timestamp;
        user_account.status = UserStatus::Active;
        Ok(())
    }
    
    pub fn create_transaction(
        ctx: Context<CreateTransaction>,
        tx_id: [u8; 16],
        user_phone: [u8; 14],
        tx_type: TransactionType,
        amount_ngn: u64,
        amount_usdc: Option<u64>,
        fee: u64,
    ) -> Result<()> {
        let config = &ctx.accounts.config;
        
        // Check if contract is paused
        if config.paused {
            return Err(OuhError::ContractPaused.into());
        }
        
        // Check transaction limits
        if amount_ngn < config.min_limit || amount_ngn > config.max_limit {
            return Err(OuhError::TransactionLimitOutOfBounds.into());
        }
        
        let user_account = &ctx.accounts.user_account;
        if user_account.status != UserStatus::Active {
            return Err(OuhError::UserSuspended.into());
        }
        
        let transaction = &mut ctx.accounts.transaction_account;
        transaction.tx_id = tx_id;
        transaction.user_phone = user_phone;
        transaction.tx_type = tx_type;
        transaction.amount_ngn = amount_ngn;
        transaction.amount_usdc = amount_usdc;
        transaction.status = TransactionStatus::Pending;
        transaction.timestamp = Clock::get()?.unix_timestamp;
        transaction.fee = fee;
        
        Ok(())
    }
    
    pub fn complete_transaction(
        ctx: Context<CompleteTransaction>,
    ) -> Result<()> {
        let transaction = &mut ctx.accounts.transaction_account;
        transaction.status = TransactionStatus::Completed;
        
        // Update user's total volume
        let user_account = &mut ctx.accounts.user_account;
        user_account.total_volume = user_account.total_volume
            .checked_add(transaction.amount_ngn)
            .unwrap();
        
        Ok(())
    }
    
    pub fn get_user_balance(
        ctx: Context<GetUserBalance>,
    ) -> Result<u64> {
        let user_account = &ctx.accounts.user_account;
        Ok(user_account.total_volume)
    }
}

// PDA Seeds
pub const USER_SEED: &[u8] = b"user";
pub const TRANSACTION_SEED: &[u8] = b"transaction";
pub const CONFIG_SEED: &[u8] = b"config";

// Account Structures
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

// Enums
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

// Account Size Implementations
impl UserAccount {
    pub const LEN: usize = 8 + 14 + 32 + 32 + 8 + 8 + 1;
}

impl TransactionAccount {
    pub const LEN: usize = 8 + 16 + 14 + 1 + 8 + 9 + 1 + 8 + 8;
}

impl Config {
    pub const LEN: usize = 8 + 32 + 2 + 2 + 8 + 8 + 1;
}

// Context Structs
#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(
        init,
        payer = admin,
        space = Config::LEN,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(phone_number: [u8; 14])]
pub struct RegisterUser<'info> {
    #[account(
        init,
        payer = user,
        space = UserAccount::LEN,
        seeds = [USER_SEED, &phone_number],
        bump
    )]
    pub user_account: Account<'info, UserAccount>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(tx_id: [u8; 16], user_phone: [u8; 14])]
pub struct CreateTransaction<'info> {
    #[account(
        init,
        payer = user,
        space = TransactionAccount::LEN,
        seeds = [TRANSACTION_SEED, &tx_id],
        bump
    )]
    pub transaction_account: Account<'info, TransactionAccount>,
    #[account(
        mut,
        seeds = [USER_SEED, &user_phone],
        bump
    )]
    pub user_account: Account<'info, UserAccount>,
    #[account(
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CompleteTransaction<'info> {
    #[account(
        mut,
        seeds = [TRANSACTION_SEED, &transaction_account.tx_id],
        bump
    )]
    pub transaction_account: Account<'info, TransactionAccount>,
    #[account(
        mut,
        seeds = [USER_SEED, &transaction_account.user_phone],
        bump
    )]
    pub user_account: Account<'info, UserAccount>,
    #[account(mut)]
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(phone_number: [u8; 14])]
pub struct GetUserBalance<'info> {
    #[account(
        seeds = [USER_SEED, &phone_number],
        bump
    )]
    pub user_account: Account<'info, UserAccount>,
}

// Error Codes
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
    #[msg("Insufficient balance")]
    InsufficientBalance,
    #[msg("Invalid PIN")]
    InvalidPin,
}
