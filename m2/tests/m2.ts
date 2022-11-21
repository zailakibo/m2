import * as anchor from "@project-serum/anchor";
import { Program } from "@project-serum/anchor";
import { M2 } from "../target/types/m2";
import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js"
import { expect } from "chai";
import { createMint, getAccount, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";


describe("m2", () => {
	// Configure the client to use the local cluster.
	anchor.setProvider(anchor.AnchorProvider.env());

	const program = anchor.workspace.M2 as Program<M2>;

	it("should initialize user", async () => {
		const slug = "slug"
		const [user, _bump] = await PublicKey.findProgramAddress(
			[
				Buffer.from("user"),
				Buffer.from(slug.slice(0, 32)),
			],
			program.programId
		)
		const tx = await program.methods.initUser("name", slug)
			.accounts({
				user: user
			})
			.rpc();
		console.log("Your transaction signature", tx);
		const userObject = await program.account.m2User.fetch(user)
		expect(userObject.name).to.eq("name")
		expect(userObject.slug).to.eq("slug")
	});

	it("should initialize the promise", async () => {
		const provider = anchor.AnchorProvider.env()

		const connection = provider.connection;
		const Keypair = anchor.web3.Keypair;
		const payer = Keypair.generate();
		const airdropSignature = await provider.connection.requestAirdrop(
			payer.publicKey,
			LAMPORTS_PER_SOL,
		);
		await provider.connection.confirmTransaction(airdropSignature, "confirmed");

		const newProvider = new anchor.AnchorProvider(provider.connection, new anchor.Wallet(payer), {});
		const newProgram = new anchor.Program(program.idl as anchor.Idl, program.programId, newProvider) as Program<M2>

		const slug = "slug2"
		const [user, _bump] = await PublicKey.findProgramAddress(
			[
				Buffer.from("user"),
				Buffer.from(slug)
			],
			program.programId
		)
		const tx = await newProgram.methods.initUser("name", slug)
			.accounts({
				user: user
			})
			.rpc();

		const mint = await createMint(
			connection,
			payer,
			payer.publicKey,
			payer.publicKey,
			9 // We are using 9 to match the CLI decimal default exactly
		);
		const tokenAccount = await getOrCreateAssociatedTokenAccount(
			connection,
			payer,
			mint,
			payer.publicKey
		);
		await mintTo(
			connection,
			payer,
			mint,
			tokenAccount.address,
			payer.publicKey,
			10
		);
		const userObject = await program.account.m2User.fetch(user)
		const [promise] = await PublicKey.findProgramAddress([
			Buffer.from("promise"),
			payer.publicKey.toBuffer(),
			userObject.promiseCount.toBuffer('be', 8),
		], program.programId);

		const [promiseWallet] = await PublicKey.findProgramAddress([
			Buffer.from("promise_wallet"),
			payer.publicKey.toBuffer(),
			userObject.promiseCount.toBuffer('be', 8),
		], program.programId);
		const referee = Keypair.generate()
		let timeout = Math.round(Date.now() / 1000) + 1;
		const amount = 10;
		const tx2 = await newProgram.methods.initPromise(new anchor.BN(timeout), referee.publicKey, new anchor.BN(amount))
			.accounts({
				mint,
				user,
				promise,
				promiseWallet,
				fundWallet: tokenAccount.address
			})
			.rpc();
	})

	it("should initialize the promise and pay", async () => {
		const provider = anchor.AnchorProvider.env()

		const connection = provider.connection;
		const Keypair = anchor.web3.Keypair;
		const payer = Keypair.generate();
		const airdropSignature = await provider.connection.requestAirdrop(
			payer.publicKey,
			LAMPORTS_PER_SOL,
		);
		await provider.connection.confirmTransaction(airdropSignature, "confirmed");

		const newProvider = new anchor.AnchorProvider(provider.connection, new anchor.Wallet(payer), {});
		const newProgram = new anchor.Program(program.idl as anchor.Idl, program.programId, newProvider) as Program<M2>

		const slug = "slug3"
		const [user, _bump] = await PublicKey.findProgramAddress(
			[
				Buffer.from("user"),
				Buffer.from(slug)
			],
			program.programId
		)
		const tx = await newProgram.methods.initUser("name", slug)
			.accounts({
				user: user
			})
			.rpc();

		const mint = await createMint(
			connection,
			payer,
			payer.publicKey,
			payer.publicKey,
			9 // We are using 9 to match the CLI decimal default exactly
		);
		const tokenAccount = await getOrCreateAssociatedTokenAccount(
			connection,
			payer,
			mint,
			payer.publicKey
		);
		await mintTo(
			connection,
			payer,
			mint,
			tokenAccount.address,
			payer.publicKey,
			100
		);
		const userObject = await program.account.m2User.fetch(user)
		const [promise] = await PublicKey.findProgramAddress([
			Buffer.from("promise"),
			payer.publicKey.toBuffer(),
			userObject.promiseCount.toBuffer('be', 8),
		], program.programId);

		const [promiseWallet] = await PublicKey.findProgramAddress([
			Buffer.from("promise_wallet"),
			payer.publicKey.toBuffer(),
			userObject.promiseCount.toBuffer('be', 8),
		], program.programId);
		let timeout = Math.round(Date.now() / 1000) + 10;
		const amount = 10;
		const tx2 = await newProgram.methods.initPromise(new anchor.BN(timeout), provider.publicKey, new anchor.BN(amount))
			.accounts({
				mint,
				user,
				promise,
				promiseWallet,
				fundWallet: tokenAccount.address
			})
			.rpc();
		console.log('promise tx', tx2);

		// check if the user has only 90 => 100 - 10
		let currentUserTokenAccount = await getAccount(connection, tokenAccount.address);
		expect(currentUserTokenAccount.amount.toString()).to.eq('90');
		console.log('should pay...');
		const tx3 = await program.methods.pay(new anchor.BN(amount), new anchor.BN(0))
			.accounts({
				promise,
				promiseWallet,
				beneficiaryTokenAccount: tokenAccount.address,
				authority: promiseWallet
			})
			.rpc()
		currentUserTokenAccount = await getAccount(connection, tokenAccount.address);
		expect(currentUserTokenAccount.amount.toString()).to.eq('100');

		console.log('payment tx', tx3)
	})

	it("should initialize the promise, but not pay, cuz TLE", async () => {
		const provider = anchor.AnchorProvider.env()

		const connection = provider.connection;
		const Keypair = anchor.web3.Keypair;
		const payer = Keypair.generate();
		const airdropSignature = await provider.connection.requestAirdrop(
			payer.publicKey,
			LAMPORTS_PER_SOL,
		);
		await provider.connection.confirmTransaction(airdropSignature, "confirmed");

		const newProvider = new anchor.AnchorProvider(provider.connection, new anchor.Wallet(payer), {});
		const newProgram = new anchor.Program(program.idl as anchor.Idl, program.programId, newProvider) as Program<M2>

		const slug = "slug5"
		const [user, _bump] = await PublicKey.findProgramAddress(
			[
				Buffer.from("user"),
				Buffer.from(slug)
			],
			program.programId
		)
		const tx = await newProgram.methods.initUser("name", slug)
			.accounts({
				user: user
			})
			.rpc();

		const mint = await createMint(
			connection,
			payer,
			payer.publicKey,
			payer.publicKey,
			9 // We are using 9 to match the CLI decimal default exactly
		);
		const tokenAccount = await getOrCreateAssociatedTokenAccount(
			connection,
			payer,
			mint,
			payer.publicKey
		);
		await mintTo(
			connection,
			payer,
			mint,
			tokenAccount.address,
			payer.publicKey,
			100
		);
		const userObject = await program.account.m2User.fetch(user)
		const [promise] = await PublicKey.findProgramAddress([
			Buffer.from("promise"),
			payer.publicKey.toBuffer(),
			userObject.promiseCount.toBuffer('be', 8),
		], program.programId);

		const [promiseWallet] = await PublicKey.findProgramAddress([
			Buffer.from("promise_wallet"),
			payer.publicKey.toBuffer(),
			userObject.promiseCount.toBuffer('be', 8),
		], program.programId);
		let timeout = Math.floor(Date.now() / 1000) - 2;
		const amount = 10;
		const tx2 = await newProgram.methods.initPromise(new anchor.BN(timeout), provider.publicKey, new anchor.BN(amount))
			.accounts({
				mint,
				user,
				promise,
				promiseWallet,
				fundWallet: tokenAccount.address
			})
			.rpc();
		console.log('promise tx', tx2);

		// check if the user has only 90 => 100 - 10
		let currentUserTokenAccount = await getAccount(connection, tokenAccount.address);
		expect(currentUserTokenAccount.amount.toString()).to.eq('90');
		console.log('should not pay...');
		const error = await program.methods.pay(new anchor.BN(amount), new anchor.BN(0))
			.accounts({
				promise,
				promiseWallet,
				beneficiaryTokenAccount: tokenAccount.address,
				authority: promiseWallet
			})
			.rpc()
			.catch(e => e);

		// the same value, user should be not get the money back...
		currentUserTokenAccount = await getAccount(connection, tokenAccount.address);
		expect(currentUserTokenAccount.amount.toString()).to.eq('90');

		expect(error.message).to.contains('TimeLimitExceed')
	})

	it("should collect failure", async () => {
		const provider = anchor.AnchorProvider.env()

		const connection = provider.connection;
		const Keypair = anchor.web3.Keypair;
		const payer = Keypair.generate();
		const airdropSignature = await provider.connection.requestAirdrop(
			payer.publicKey,
			LAMPORTS_PER_SOL,
		);
		await provider.connection.confirmTransaction(airdropSignature, "confirmed");

		const newProvider = new anchor.AnchorProvider(provider.connection, new anchor.Wallet(payer), {});
		const newProgram = new anchor.Program(program.idl as anchor.Idl, program.programId, newProvider) as Program<M2>

		const slug = "slug6"
		const [user, _bump] = await PublicKey.findProgramAddress(
			[
				Buffer.from("user"),
				Buffer.from(slug)
			],
			program.programId
		)
		const tx = await newProgram.methods.initUser("name", slug)
			.accounts({
				user: user
			})
			.rpc();

		const mint = await createMint(
			connection,
			payer,
			payer.publicKey,
			payer.publicKey,
			9 // We are using 9 to match the CLI decimal default exactly
		);
		const tokenAccount = await getOrCreateAssociatedTokenAccount(
			connection,
			payer,
			mint,
			payer.publicKey
		);
		await mintTo(
			connection,
			payer,
			mint,
			tokenAccount.address,
			payer.publicKey,
			100
		);
		const userObject = await program.account.m2User.fetch(user)
		const [promise] = await PublicKey.findProgramAddress([
			Buffer.from("promise"),
			payer.publicKey.toBuffer(),
			userObject.promiseCount.toBuffer('be', 8),
		], program.programId);

		const [promiseWallet] = await PublicKey.findProgramAddress([
			Buffer.from("promise_wallet"),
			payer.publicKey.toBuffer(),
			userObject.promiseCount.toBuffer('be', 8),
		], program.programId);
		let timeout = Math.floor(Date.now() / 1000) - 2;
		const amount = 10;
		const tx2 = await newProgram.methods.initPromise(new anchor.BN(timeout), provider.publicKey, new anchor.BN(amount))
			.accounts({
				mint,
				user,
				promise,
				promiseWallet,
				fundWallet: tokenAccount.address
			})
			.rpc();
		console.log('promise tx', tx2);

		// check if the user has only 90 => 100 - 10
		let currentUserTokenAccount = await getAccount(connection, tokenAccount.address);
		expect(currentUserTokenAccount.amount.toString()).to.eq('90');
		console.log('should not pay...');
		const error = await program.methods.pay(new anchor.BN(amount), new anchor.BN(0))
			.accounts({
				promise,
				promiseWallet,
				beneficiaryTokenAccount: tokenAccount.address,
				authority: promiseWallet
			})
			.rpc()
			.catch(e => e);

		// the same value, user should be not get the money back...
		currentUserTokenAccount = await getAccount(connection, tokenAccount.address);
		expect(currentUserTokenAccount.amount.toString()).to.eq('90');

		expect(error.message).to.contains('TimeLimitExceed')

		console.log('should collect broken promises...')
		const daoTokenAccount = await getOrCreateAssociatedTokenAccount(
			connection,
			payer,
			mint,
			provider.publicKey
		);
		await program.methods.collectBrokenPromises(new anchor.BN(0))
			.accounts({
				promise,
				promiseWallet,
				destinationWallet: daoTokenAccount.address
			})
			.rpc()

		const daoAccount = await getAccount(connection, daoTokenAccount.address);
		expect(daoAccount.amount.toString()).to.eq('10')
	})
});
