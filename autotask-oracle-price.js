// ORACLE PRICE ALERT - note there's never been an alert to this agent yet
// agent id - 0x8a6e2ae3b279c561f7ba64e5011313df19e08b1f398d59d94dfbd4148e6cafce

const axios = require('axios');
const ethers = require('ethers');

// import the DefenderRelayProvider to interact with its JSON-RPC endpoint
const { DefenderRelayProvider } = require('defender-relay-client/lib/ethers');

const TOKEN_ABI = [
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
];
const MAKER_TOKEN_ABI = [
  'function decimals() view returns (uint256)',
  'function symbol() view returns (bytes32)',
];
const CTOKEN_ABI = ['function underlying() view returns (address)'];

const makerTokenAddress = '0x9f8F72aA9304c8B593d555F12eF6589cC3A579A2'.toLowerCase();
const saiTokenAddress = '0x89d24A6b4CcB1B6fAA2625fE562bDD9a23260359'.toLowerCase();
const oddTokens = [makerTokenAddress, saiTokenAddress];

const fortaApiEndpoint = 'https://api.forta.network/graphql';

// axios post request for forta graphql api
async function post(url, method, headers, data) {
  return axios({
    url, method, headers, data,
  });
}

async function getDecimalsAndSymbol(cTokenAddress, provider) {
  const cTokenContract = new ethers.Contract(
    cTokenAddress,
    CTOKEN_ABI,
    provider,
  );
  const underlyingTokenAddress = await cTokenContract.underlying();

  let decimals;
  let symbol;
  if (oddTokens.indexOf(underlyingTokenAddress.toLowerCase()) !== -1) {
    const underlyingTokenContract = new ethers.Contract(
      underlyingTokenAddress,
      MAKER_TOKEN_ABI,
      provider,
    );

    decimals = await underlyingTokenContract.decimals();
    // need to convert decimals from uint256 to uint8
    decimals = parseInt(decimals.toString(), 10);

    symbol = await underlyingTokenContract.symbol();
    // need to convert symbol from bytes32 to string
    symbol = ethers.utils.parseBytes32String(symbol);
  } else {
    const underlyingTokenContract = new ethers.Contract(
      underlyingTokenAddress,
      TOKEN_ABI,
      provider,
    );
    decimals = await underlyingTokenContract.decimals();
    symbol = await underlyingTokenContract.symbol();
  }
  return { decimals, symbol };
}

function formatAmountString(amount, decimals) {
  const amountBN = ethers.BigNumber.from(amount);
  const divisorBN = ethers.BigNumber.from(10).pow(decimals);

  // the ethers BigNumber implementation will discard the decimal
  // portion of the value when we perform the division
  let resultString = amountBN.toString();
  if (resultString.length <= decimals) {
    resultString = `0.${'0'.repeat(decimals - resultString.length)}${resultString[0]}`;
  } else {
    resultString = amountBN.div(divisorBN).toString();
  }

  // format the number to have comma separators for powers of 1000
  const internationalNumberFormat = new Intl.NumberFormat('en-US');
  return internationalNumberFormat.format(resultString);
}

async function createDiscordMessage(reporterPrice, cTokenAddress, transactionHash, provider) {
  const { decimals, symbol } = await getDecimalsAndSymbol(cTokenAddress, provider);

  const amountString = formatAmountString(reporterPrice, decimals);

  // // construct the Etherscan transaction link
  const etherscanLink = `[TX](<https://etherscan.io/tx/${transactionHash}>)`;

  return `${etherscanLink} 🚫 reported price of **${amountString}** for **${symbol}** was rejected`;
}

// post to discord
async function postToDiscord(url, message) {
  const method = 'post';
  const headers = {
    'Content-Type': 'application/json',
  };
  const data = JSON.stringify({ content: message });

  let response;
  try {
    // perform the POST request
    response = await post(url, method, headers, data);
  } catch (error) {
    // is this a "too many requests" error (HTTP status 429)
    if (error.response && error.response.status === 429) {
      // the request was made and a response was received
      // try again after waiting 5 seconds
      // eslint-disable-next-line no-promise-executor-return
      const promise = new Promise((resolve) => setTimeout(resolve, 5000));
      await promise;
      response = await post(url, method, headers, data);
    } else {
      // re-throw the error if it's not from a 429 status
      throw error;
    }
  }

  return response;
}

async function getFortaAlerts(agentId, transactionHash) {
  const headers = {
    'content-type': 'application/json',
  };

  const graphqlQuery = {
    operationName: 'recentAlerts',
    query: `query recentAlerts($input: AlertsInput) {
      alerts(input: $input) {
        pageInfo {
          hasNextPage
          endCursor {
            alertId
            blockNumber
          }
        }
        alerts {
          createdAt
          name
          protocol
          findingType
          hash
          source {
            transactionHash
            block {
              number
              chainId
            }
            agent {
              id
            }
          }
          severity
		  metadata
		  description
        }
      }
    }`,
    variables: {
      input: {
        first: 100,
        agents: [agentId],
        transactionHash,
        createdSince: 0,
        chainId: 1,
      },
    },
  };

  // perform the POST request
  const response = await axios({
    url: fortaApiEndpoint,
    method: 'post',
    headers,
    data: graphqlQuery,
  });

  const { data } = response;
  if (data === undefined) {
    return undefined;
  }

  console.log('Forta Public API data');
  console.log(JSON.stringify(data, null, 2));
  const { data: { alerts: { alerts } } } = data;
  return alerts;
}

// entry point for autotask
// eslint-disable-next-line func-names
exports.handler = async function (autotaskEvent) {
  // ensure that the autotaskEvent Object exists
  if (autotaskEvent === undefined) {
    return {};
  }
  console.log('Autotask Event');
  console.log(JSON.stringify(autotaskEvent, null, 2));

  const { secrets } = autotaskEvent;
  if (secrets === undefined) {
    return {};
  }

  // ensure that there is a DiscordUrl secret. Name changes depending on what webhook secret you use
  const { FortaSentinelTestingDiscord: discordUrl } = secrets;
  if (discordUrl === undefined) {
    return {};
  }

  // ensure that the request key exists within the autotaskEvent Object
  const { request } = autotaskEvent;
  if (request === undefined) {
    return {};
  }

  // ensure that the body key exists within the request Object
  const { body } = request;
  if (body === undefined) {
    return {};
  }
  console.log('Body');
  console.log(JSON.stringify(body, null, 2));

  // ensure that the alert key exists within the body Object
  const { alert } = body;
  if (alert === undefined) {
    return {};
  }

  // extract the transaction hash and agent ID from the alert Object
  const {
    hash,
    source: {
      transactionHash,
      agent: {
        id: agentId,
      },
    },
  } = alert;

  // retrieve the metadata from the Forta public API
  let alerts = await getFortaAlerts(agentId, transactionHash);
  alerts = alerts.filter((alertObject) => alertObject.hash === hash);
  console.log('Alerts here', alerts);
  console.log(JSON.stringify(alerts, null, 2));

  // use the relayer provider for JSON-RPC requests
  const provider = new DefenderRelayProvider(autotaskEvent);

  const promises = alerts.map((alertData) => {
    const { metadata } = alertData;
    const { reporterPrice, cTokenAddress } = metadata;

    return createDiscordMessage(
      reporterPrice,
      cTokenAddress,
      transactionHash,
      provider,
    );
  });

  // wait for the promises to settle
  const messages = await Promise.all(promises);

  // create promises for posting messages to Discord webhook
  const discordPromises = messages.map((message) => postToDiscord(discordUrl, `${message}`));

  // wait for the promises to settle
  await Promise.all(discordPromises);

  return {};
};

/* oracle metadata
    "description": The new price reported by ValidatorProxy ${priceReporterAddress} was rejected `
      + `for cToken ${cTokenAddress}`,
    "metadata": {
      cTokenAddress,
      underlyingTokenAddress,
      validatorProxyAddress: priceReporterAddress,
      anchorPrice: currentPrice,
      reporterPrice: rejectedPrice,
    },

  */

/* this is what the alerts look like
{
              "createdAt": "2022-03-31T22:02:20.896030912Z",
              "name": "Compound Distribution Event",
              "protocol": "Compound",
              "findingType": "SUSPICIOUS",
              "hash": "0x4f3d54010dfb0ca0d78d3c01c45daaaeafc4d68298d98fbe995f4baa2f8996ae",
              "source": {
                "transactionHash": "0x4ba3bfee3221bf246bfa34bb6ef107a922896cb7d97b50e40793288113468e21",
                "block": {
                  "number": 14496506,
                  "chainId": 1
                },
                "agent": {
                  "id": "0xfca83adc900f88f22dafcd91117d0929343cba3f18e4607bcd861ff0bcd706fa"
                }
              },
              "severity": "HIGH",
              "metadata": {
                "compAccrued": "0",
                "compDistributed": "4989396791922",
                "receiver": "0x8F077BbA8221Edd9faaaE96668F17b47F1Cb9e5d"
              },
              "description": "Distributed Infinity% more COMP to 0x8F077BbA8221Edd9faaaE96668F17b47F1Cb9e5d than expected"
            },

  this is what the query to the forta api returns
  {
  "data": {
    "alerts": {
      "pageInfo": {
        "hasNextPage": false,
        "endCursor": {
          "alertId": "",
          "blockNumber": 0
        }
      },
      "alerts": [
        {
          "createdAt": "2022-03-31T22:02:20.812799122Z",
          "name": "Compound Distribution Event",
          "protocol": "Compound",
          "findingType": "SUSPICIOUS",
          "hash": "0xcee8d4bd1c065260acdcfa51c955fc29c984145de2769b685f29701b6edf318f",
          "source": {
            "transactionHash": "0xb28081d9792a1ddbed59632e4b77f1130b100d17d8bf0056756321aaca1a206d",
            "block": {
              "number": 14496506,
              "chainId": 1
            },
            "agent": {
              "id": "0xfca83adc900f88f22dafcd91117d0929343cba3f18e4607bcd861ff0bcd706fa"
            }
          },
          "severity": "HIGH",
          "metadata": {
            "compAccrued": "0",
            "compDistributed": "56963909736319",
            "receiver": "0xAC6A6388691F564Cb69e4082E2bd4e347A978bF6"
          },
          "description": "Distributed Infinity% more COMP to 0xAC6A6388691F564Cb69e4082E2bd4e347A978bF6 than expected"
        },
        {
          "createdAt": "2022-03-31T22:02:20.835775602Z",
          "name": "Compound Distribution Event",
          "protocol": "Compound",
          "findingType": "SUSPICIOUS",
          "hash": "0x881bf08b7b97b50152fb60b12483a4b98427a67e3f6a55e8db75671546ce54d5",
          "source": {
            "transactionHash": "0xb28081d9792a1ddbed59632e4b77f1130b100d17d8bf0056756321aaca1a206d",
            "block": {
              "number": 14496506,
              "chainId": 1
            },
            "agent": {
              "id": "0xfca83adc900f88f22dafcd91117d0929343cba3f18e4607bcd861ff0bcd706fa"
            }
          },
          "severity": "HIGH",
          "metadata": {
            "compAccrued": "0",
            "compDistributed": "57424054190753",
            "receiver": "0x8F077BbA8221Edd9faaaE96668F17b47F1Cb9e5d"
          },
          "description": "Distributed Infinity% more COMP to 0x8F077BbA8221Edd9faaaE96668F17b47F1Cb9e5d than expected"
        }
      ]
    }
  }
}
*/
