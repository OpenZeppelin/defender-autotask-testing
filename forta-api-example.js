const axios = require('axios');
const ethers = require('ethers');

const fortaApiEndpoint = 'https://api.forta.network/graphql';

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

// axios post request for forta graphql api
async function post(url, method, headers, data) {
  return axios({
    url, method, headers, data,
  });
}

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

async function main() {
  let alerts = getFortaAlerts("0xfca83adc900f88f22dafcd91117d0929343cba3f18e4607bcd861ff0bcd706fa", "0xb28081d9792a1ddbed59632e4b77f1130b100d17d8bf0056756321aaca1a206d")
  console.log("look here for alerts", alerts)
  // await postToDiscord("https://discord.com/api/webhooks/963891500897423360/Zx8MzPcEfFPDoqpOjGXoBu3303FPvj0NAX4pHUsOll3G5N2TlaThiQUOUDfyQm0tWhiP", "this should show up in discord")
}

main()