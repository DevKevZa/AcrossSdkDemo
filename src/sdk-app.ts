import { ethers, formatEther, parseEther } from "ethers";
import { AcrossChain, AcrossClient, ChainsQueryResponse, createAcrossClient, ExecuteQuoteResponseParams, ExecutionProgress, GetQuoteParams, Quote, TokenInfo } from "@across-protocol/app-sdk";
import dotenv from "dotenv";
import { baseSepolia, arbitrumSepolia, opBNBTestnet, sepolia, optimismSepolia } from "viem/chains";
import { Account, InsufficientFundsError, createPublicClient, createWalletClient, getContract, http } from "viem";
import { privateKeyToAccount } from 'viem/accounts';
import { infura } from "./constants";


//Load .env contents into process.env (where I added pk and rpc url)
dotenv.config();
console.log("Loaded Infura project key: ", process.env.INFURA_PROJECT_KEY)
console.log("Loaded Pub Key: ", process.env.PUBLIC_KEY)
console.log("Loaded PK: ", process.env.PRIVATE_KEY)

const originChain = sepolia;
const destinationChain = arbitrumSepolia;
const originTokenSymbol: string = "ETH"
const destTokenSymbol: string = "WETH"

console.log(`Origin chain selected: ${originChain.name}`);
console.log(`Destination chain selected: ${destinationChain.name}`);

// Load wallet provider (used infuria because of integration with metamask?)
// Wallet providers allow you to make Remote Procedure Calls (RPC's) to their nodes that are running an instance of 'x' chain
// These endpoints allow you to interact with the chain - Read + Write actions (read balances, read and create transactions, deploy contracts)

const account: Account = privateKeyToAccount(`0x${process.env.PRIVATE_KEY!}`);

function getPK(): string {
    return account.address;
}
function getPubKey(): `0x${string}`  {
    return process.env.PUBLIC_KEY as `0x${string}`;
}
function getOriginChainRpcUrl(): `0x${string}` {
    return infura.SepoliaPrefixes.Sepolia + process.env.INFURA_PROJECT_KEY as `0x${string}`;
}
function getDestinationChainRpcUrl(): string {
    return infura.SepoliaPrefixes.Arbitrum + process.env.INFURA_PROJECT_KEY;
}

const walletClient = createWalletClient({
    account: account,
    chain: originChain,
    transport: http(getOriginChainRpcUrl()),
})

const publicClient = createPublicClient({
  chain: sepolia,
  transport: http(getOriginChainRpcUrl())
});

async function preValidate() {
    console.log("Validating balance of wallet with pub key: ", getPubKey())
    
    const weiBalance = await publicClient.getBalance({ address: getPubKey() });

    console.log("wei balance: ", weiBalance);
    
    const ethBalance = ethers.formatEther(weiBalance);
    console.log("Balance in ETH:", ethBalance); // "1.23"

    if (Number(ethBalance) < 0.01) {
      console.log("Insufficient funds... Exiting early");
      throw new InsufficientFundsError();
    }
}

async function getQuote(client: AcrossClient): Promise<Quote> {
    const chains: ChainsQueryResponse = await client.getSupportedChains({});

    const originAcrossChain: AcrossChain = chains.find((x: AcrossChain) => x.chainId == originChain.id);
    const originTokenInfo: TokenInfo = originAcrossChain.inputTokens.find(x => x.symbol == originTokenSymbol);

    const destinationAcrossChain: AcrossChain = chains.find((x: AcrossChain) => x.chainId == destinationChain.id);
    const destinationTokenInfo: TokenInfo = destinationAcrossChain.inputTokens.find(x => x.symbol == destTokenSymbol);

    const intent: GetQuoteParams = {
        route: {
            originChainId: originChain.id,
            destinationChainId: destinationChain.id,
            inputToken: originTokenInfo.address,
            outputToken:  destinationTokenInfo.address
        },
        inputAmount: parseEther("0.0002"),
    };

    console.log("Requesting quote from Across...");
    const quote: Quote = await client.getQuote(intent);

    // Pretty display
    console.log("=== Quote Received ===");
    console.log(`You send: ${formatEther(quote.deposit.inputAmount)} ETH on Chain ${originChain.name}`);
    console.log(`You receive: ${formatEther(quote.deposit.outputAmount)} WETH on Chain ${destinationChain.name}`);
    console.log(`Bridge fee: ${formatEther(quote.fees.totalRelayFee.total)}`);
    console.log(`Estimated time: ${quote.estimatedFillTimeSec || 'N/A'} seconds`);

    return quote;
}


async function bridge() {
    // validate funds for bridging
    await preValidate();

    // create an Across client
    const client: AcrossClient = createAcrossClient({
        integratorId: "0xdead", // 2-byte hex string
        chains: [originChain, destinationChain],
        useTestnet: true,
    });

    // quote the desired transaction
    const quote = await getQuote(client);

    const onProgressCallback = (progress: ExecutionProgress) => {
        if (progress.status !== "txSuccess") {
            console.log(`Step '${progress.step}' failed with status: ${progress.status}`);
            return;
        }

        switch (progress.step) {
            case "approve":
                // if approving an ERC20, you have access to the approval receipt
                const { txReceipt } = progress;
                console.log("Approval receipt received: ", txReceipt);
                break;
            case "deposit":
                // once deposit is successful you have access to depositId and the receipt
                const { depositId } = progress;
                console.log("Deposit Id received receipt: ", depositId);
                break;
            case "fill":
                // if the fill is successful, you have access the following data
                // actionSuccess is a boolean flag, telling us if your cross chain messages were successful
                const { fillTxTimestamp, actionSuccess } = progress;
                console.log("Order successfully filled at: ", fillTxTimestamp)
                break;
            default:
                console.log("Unknown step: ", JSON.stringify(progress));
        }
    }

    // do the bridging
    const bridgeResult: ExecuteQuoteResponseParams = await client.executeQuote({
        walletClient: walletClient, 
        deposit: quote.deposit,
        onProgress: onProgressCallback,
    });

    if (bridgeResult.error) {
        console.log("Bridge failed with error: ", bridgeResult.error);
    } else {
        console.log(JSON.stringify(bridgeResult));
    }

}

bridge();

