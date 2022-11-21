use anchor_lang::{prelude::*, system_program};
use anchor_spl::token::{self, Mint, SetAuthority, Token, TokenAccount, Transfer};
use token::spl_token::instruction::AuthorityType;

const DISCRIMINATOR_LENGTH: usize = 8;
const PUBLIC_KEY_LENGTH: usize = 32;
const U64_LENGTH: usize = 8;

#[error_code]
pub enum M2Errors {
    #[msg("Wrong referee")]
    WrongReferee,

    #[msg("Wrong beneficiary")]
    WrongBeneficiary,

    #[msg("Time Limit Exceed")]
    TimeLimitExceed,

    #[msg("Not expired")]
    NotExpired,
}

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod m2 {
    use super::*;

    pub fn init_user(ctx: Context<IniUser>, name: String, slug: String) -> Result<()> {
        let user = &mut ctx.accounts.user;
        user.name = name;
        user.slug = slug;
        user.promise_count = 0;
        user.user_pk = ctx.accounts.sender.key();
        Ok(())
    }

    pub fn init_promise(
        ctx: Context<IniPromise>,
        timeout: i64,
        referee: Pubkey,
        amount: u64,
    ) -> Result<()> {
        let promise = &mut ctx.accounts.promise;
        let mint = &ctx.accounts.mint;
        promise.referee = referee;
        promise.timeout = timeout;
        promise.amount = amount;
        promise.init_amount = amount;
        promise.mint = mint.key();
        promise.beneficiary = ctx.accounts.sender.key();
        let user = &mut ctx.accounts.user;

        //take the ownership of this TokenAccount
        let cpi_accounts = SetAuthority {
            account_or_mint: ctx.accounts.promise_wallet.to_account_info(),
            current_authority: ctx.accounts.sender.to_account_info(),
        };
        let cpi_context =
            CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
        let (vault_authority, _bump) = Pubkey::find_program_address(
            &[
                b"promise_wallet".as_ref(),
                ctx.accounts.sender.key().as_ref(),
                &user.promise_count.to_be_bytes(),
            ],
            ctx.program_id,
        );
        token::set_authority(
            cpi_context,
            AuthorityType::AccountOwner,
            Some(vault_authority),
        )?;

        // transfer from fund to escrow
        let sender = &ctx.accounts.sender.key();
        let (_vault_authority, vault_authority_bump) = Pubkey::find_program_address(
            &[
                b"promise_wallet".as_ref(),
                sender.as_ref(),
                &user.promise_count.to_be_bytes(),
            ],
            ctx.program_id,
        );
        let authority_seeds = &[
            b"promise_wallet".as_ref(),
            sender.as_ref(),
            &user.promise_count.to_be_bytes(),
            &[vault_authority_bump],
        ];
        let signer = &[&authority_seeds[..]];
        let cpi_accounts = Transfer {
            from: ctx.accounts.fund_wallet.to_account_info(),
            to: ctx.accounts.promise_wallet.to_account_info(),
            authority: ctx.accounts.sender.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        token::transfer(cpi_ctx, amount)?;

        // increment the promise count
        user.promise_count += 1;
        Ok(())
    }

    pub fn pay(ctx: Context<Pay>, amount: u64, promise_id: u64) -> Result<()> {
        let sender = &ctx.accounts.sender;
        let promise = &mut ctx.accounts.promise;
        if sender.key() != promise.referee.key() {
            return Err(error!(M2Errors::WrongReferee));
        }
        promise.amount -= amount;
        let beneficiary = ctx.accounts.beneficiary_token_account.owner;
        if beneficiary != promise.beneficiary {
            return Err(error!(M2Errors::WrongBeneficiary));
        }
        let clock = Clock::get()?;
        let now = clock.unix_timestamp.try_into().unwrap();
        if promise.timeout < now {
            return Err(error!(M2Errors::TimeLimitExceed));
        }
        let seeds = &[
            b"promise_wallet".as_ref(),
            beneficiary.as_ref(),
            &promise_id.to_be_bytes(),
        ];
        let (_, vault_authority_bump) = Pubkey::find_program_address(seeds, ctx.program_id);

        let mut authority_seeds = seeds.to_vec();
        let bump_seed = [vault_authority_bump];
        authority_seeds.push(&bump_seed);
        let signer = &[&authority_seeds[..]];
        let cpi_accounts = Transfer {
            from: ctx.accounts.promise_wallet.to_account_info(),
            to: ctx.accounts.beneficiary_token_account.to_account_info(),
            authority: ctx.accounts.authority.clone(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        token::transfer(cpi_ctx, amount)?;
        Ok(())
    }

    pub fn collect_broken_promises(ctx: Context<CollectFailure>, promise_id: u64) -> Result<()> {
        let promise = &mut ctx.accounts.promise;
        let clock = Clock::get()?;
        let now = clock.unix_timestamp.try_into().unwrap();
        if promise.timeout >= now {
            return Err(error!(M2Errors::NotExpired));
        }
        let beneficiary = &promise.beneficiary;
        let seeds = &[
            b"promise_wallet".as_ref(),
            beneficiary.as_ref(),
            &promise_id.to_be_bytes(),
        ];
        let (_, vault_authority_bump) = Pubkey::find_program_address(seeds, ctx.program_id);

        let mut authority_seeds = seeds.to_vec();
        let bump_seed = [vault_authority_bump];
        authority_seeds.push(&bump_seed);
        let signer = &[&authority_seeds[..]];
        let cpi_accounts = Transfer {
            from: ctx.accounts.promise_wallet.to_account_info(),
            to: ctx.accounts.destination_wallet.to_account_info(),
            authority: ctx.accounts.promise_wallet.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        token::transfer(cpi_ctx, promise.amount)?;
        Ok(())
    }
}

fn slug_seed(slug: &str) -> &[u8] {
    let b = slug.as_bytes();
    if b.len() > 32 {
        &b[0..32]
    } else {
        b
    }
}

#[derive(Accounts)]
pub struct CollectFailure<'info> {
    #[account()]
    pub promise: Account<'info, M2Promise>,

    #[account(mut)]
    promise_wallet: Account<'info, TokenAccount>,

    #[account(mut)]
    destination_wallet: Account<'info, TokenAccount>,

    #[account(address = token::ID)]
    pub token_program: Program<'info, Token>,

    #[account(mut)]
    pub sender: Signer<'info>,
}

#[derive(Accounts)]
pub struct Pay<'info> {
    #[account(mut)]
    pub promise: Account<'info, M2Promise>,

    #[account(mut)]
    pub sender: Signer<'info>,

    #[account(mut)]
    promise_wallet: Account<'info, TokenAccount>,

    #[account(mut)]
    beneficiary_token_account: Account<'info, TokenAccount>,

    #[account(address = token::ID)]
    pub token_program: Program<'info, Token>,

    /// CHECK: xxx
    pub authority: AccountInfo<'info>,
}

#[derive(Accounts)]
#[instruction(timeout: u64, referee: Pubkey)]
pub struct IniPromise<'info> {
    #[account(
        init,
        space = M2Promise::LEN,
        payer = sender,
        seeds = [
            b"promise".as_ref(),
            sender.key().as_ref(),
            &user.promise_count.to_be_bytes().as_ref(),
        ],
        bump
    )]
    pub promise: Account<'info, M2Promise>,

    mint: Account<'info, Mint>, // Some token like USDC

    #[account(
        init,
        payer = sender,
        seeds = [
            b"promise_wallet".as_ref(),
            sender.key().as_ref(),
            &user.promise_count.to_be_bytes(),
        ],
        bump,
        token::mint = mint,
        token::authority = sender,
    )]
    promise_wallet: Account<'info, TokenAccount>,

    #[account(mut)]
    pub fund_wallet: Account<'info, TokenAccount>,

    #[account(mut)]
    pub user: Account<'info, M2User>,

    #[account(mut)]
    pub sender: Signer<'info>,

    #[account(address = system_program::ID)]
    pub system_program: Program<'info, System>,

    #[account(address = token::ID)]
    pub token_program: Program<'info, Token>,

    rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
#[instruction(name: String, slug: String)]
pub struct IniUser<'info> {
    #[account(
        init,
        space = M2User::space(&name, &slug),
        payer = sender,
        seeds = [
            b"user".as_ref(),
            slug_seed(&slug).as_ref(),
        ],
        bump
    )]
    pub user: Account<'info, M2User>,

    #[account(mut)]
    pub sender: Signer<'info>,

    #[account(address = system_program::ID)]
    pub system_program: Program<'info, System>,
}

#[account]
pub struct M2User {
    pub slug: String,
    pub name: String,
    pub promise_count: u64,
    pub user_pk: Pubkey,
}

impl M2User {
    pub const LEN: usize = DISCRIMINATOR_LENGTH + U64_LENGTH + PUBLIC_KEY_LENGTH;
    pub fn space(name: &str, slug: &str) -> usize {
        M2User::LEN + 4 + slug.len() + 4 + name.len()
    }
}

#[account]
pub struct M2Promise {
    /**
     * Beneficiary Token Account
     * the guy who will do something
     * and will get the money back
     */
    pub beneficiary: Pubkey,

    /**
     * Deadline
     * After this linux epoch the money is locked
     * to the DAO
     */
    pub timeout: i64,

    /**
     * Judge, Referee
     * In charge to pay the beneficiary
     */
    pub referee: Pubkey,

    /**
     * Current amount
     */
    pub amount: u64,

    /**
     * Initial amount
     */
    pub init_amount: u64,

    /**
     * mint
     */
    pub mint: Pubkey,
}

impl M2Promise {
    pub const LEN: usize = DISCRIMINATOR_LENGTH
        + PUBLIC_KEY_LENGTH // beneficiary
        + U64_LENGTH // timeout
        + PUBLIC_KEY_LENGTH // referee
        + U64_LENGTH // amount
        + U64_LENGTH // initial amount
        + PUBLIC_KEY_LENGTH; // mint
}
