const mockedGetContract = jest.fn();
const mockedGetProvider = jest.fn();

// combine the mocked provider and contracts into the ethers import mock
jest.mock('forta-agent', () => ({
  ...jest.requireActual('forta-agent'),
  getEthersBatchProvider: mockedGetProvider,
  ethers: {
    ...jest.requireActual('ethers'),
    Contract: mockedGetContract
  },
}));

const {
  TransactionEvent, ethers, FindingType, FindingSeverity, Finding
} = require('forta-agent');

const { provideHandleTransaction, provideInitialize, createUpgradeAlert } = require('./agent');
const {
  getObjectsFromAbi,
  getEventFromConfig,
  createMockEventLogs,
} = require('./test-utils');

const { getAbi } = require('./utils');

const config = require('../agent-config.json');
const web3 = require('web3-Eth');
const web3Eth = new web3();

// utility function specific for this test module
// we are intentionally not using the Forta SDK function due to issues with
// jest mocking the module and interfering with default function values
function createTransactionEvent(txObject) {
  const txEvent = new TransactionEvent(
    null,
    null,
    txObject.transaction,
    txObject.receipt,
    [],
    txObject.addresses,
    txObject.block,
  );
  return txEvent;
}

// check the configuration file to verify the values
xdescribe('check agent configuration file', () => {
  it('procotolName key required', () => {
    const { protocolName } = config;
    expect(typeof(protocolName)).toBe('string');
    expect(protocolName).not.toBe('');
  });

  it('protocolAbbreviation key required', () => {
    const { protocolAbbreviation } = config;
    expect(typeof(protocolAbbreviation)).toBe('string');
    expect(protocolAbbreviation).not.toBe('');
  });

  it('developerAbbreviation key required', () => {
    const { developerAbbreviation } = config;
    expect(typeof(developerAbbreviation)).toBe('string');
    expect(developerAbbreviation).not.toBe('');
  });

  it('contracts key required', () => {
    const { contracts } = config;
    expect(typeof(contracts)).toBe('object');
    expect(contracts).not.toBe({});
  });

  it('contracts key values must be valid', () => {
    const { contracts } = config;

    const { Comptroller, cTokens } = contracts;
    expect(typeof(Comptroller)).toBe('object');
    expect(Comptroller).not.toBe({});

    expect(typeof(cTokens)).toBe('object');
    expect(cTokens).not.toBe({});

    const { abiFile: ComptrollerAbiFile, address: ComptrollerAddress } = Comptroller;
    const { abiFile: cTokenAbiFile } = cTokens;

    // check that the address is a valid address
    expect(ethers.utils.isHexString(ComptrollerAddress, 20)).toBe(true);

    // load the ABI from the specified file
    // the call to getAbi will fail if the file does not exist
    const ComptrollerAbi = getAbi(ComptrollerAbiFile);
    const cTokenAbi = getAbi(cTokenAbiFile);
  });

  it('excludeAddresses key required', () => {
    const { excludeAddresses } = config;
    expect(Array.isArray(excludeAddresses)).toBe(true);
    excludeAddresses.forEach((address) => {
      // check that the address is a valid address
      expect(ethers.utils.isHexString(address, 20)).toBe(true);
    });
  });

  it('proxyPatterns key required', () => {
    const { proxyPatterns } = config;
    expect(Array.isArray(proxyPatterns)).toBe(true);
    expect(proxyPatterns).not.toBe([]);
  });

  it('proxyPattern elements must be valid', () => {
    const { proxyPatterns } = config;

    proxyPatterns.forEach((pattern) => {
      expect(typeof(pattern)).toBe('object');
      expect(pattern).not.toBe({});
      
      const { name, findingType, findingSeverity, functionSignatures, eventSignatures } = pattern;

      expect(typeof(name)).toBe('string');

      // check type, this will fail if 'findingType' is not valid
      expect(Object.prototype.hasOwnProperty.call(FindingType, findingType)).toBe(true);

      // check severity, this will fail if 'findingSeverity' is not valid
      expect(Object.prototype.hasOwnProperty.call(FindingSeverity, findingSeverity)).toBe(true);      

      expect(Array.isArray(functionSignatures)).toBe(true);
      expect(functionSignatures).not.toBe([]);

      expect(Array.isArray(eventSignatures)).toBe(true);
      expect(eventSignatures).not.toBe([]);
    });
  });  
});

describe('test createUpgradeAlert', () =>  {
  let protocolName;
  let protocolAbbreviation;
  let developerAbbreviation;
  let cTokenSymbol;
  let cTokenAddress;
  let underlyingAssetAddress;
  let eventArgs;
  let modifiedArgs;
  let findingType;
  let findingSeverity;

  beforeAll(async () => {
    protocolName = config.protocolName;
    protocolAbbreviation = config.protocolAbbreviation;
    developerAbbreviation = config.developerAbbreviation;
  });

  it('returns a proper finding', () => {
    cTokenSymbol = 'TEST';
    findingType = 'Info';
    findingSeverity = 'Info';
    cTokenAddress = '0x1234';
    underlyingAssetAddress = '0x5678';
    eventArgs = {
      implementation: '0x8888'
    }
    modifiedArgs = {
      eventArgs_implementation: '0x8888'
    }

    expectedFinding = Finding.fromObject({
      name: `${protocolName} cToken Asset Upgraded`,
      description: `The underlying asset for the ${cTokenSymbol} cToken contract was upgraded`,
      alertId: `${developerAbbreviation}-${protocolAbbreviation}-CTOKEN-ASSET-UPGRADED`,
      type: FindingType[findingType],
      severity: FindingSeverity[findingSeverity],
      protocol: protocolName,
      metadata: {
        cTokenSymbol,
        cTokenAddress,
        underlyingAssetAddress,
        ...modifiedArgs
      }
    }); 

    finding = createUpgradeAlert(
      protocolName,
      protocolAbbreviation,
      developerAbbreviation,
      cTokenSymbol,
      cTokenAddress,
      underlyingAssetAddress,
      eventArgs,
      findingType,
      findingSeverity      
    )

    expect(finding).toStrictEqual(expectedFinding);
  })
});

// tests
xdescribe('monitor compound for upgraded cToken assets', () => {
  describe('handleTransaction', () => {
    let initializeData;
    let protocolName;
    let protocolAbbreviation;
    let developerAbbreviation;
    let handleTransaction;
    let mockedCTokenContract;
    let mockComptrollerContract;
    let mockedProvider;
    let mockTxEvent;
    let testEventAbi;
    let testEventIFace;
    let validFunctionSignature = 'TestFunction(address)';
    let validFunctionHash;
    let validCTokenAddress = `0x1${'0'.repeat(39)}`;
    let validAssetAddress = `0x5${'0'.repeat(39)}`;
    let validUpgradeAddress = `0x9${'0'.repeat(39)}`;
    let validSymbol = 'TEST';

    beforeAll(async () => {
      mockedProvider = {
        getCode: jest.fn()
      };
      mockedGetProvider.mockReturnValue(mockedProvider)

      const { proxyPatterns } = config; 

      testPattern = {
        name: 'testPattern',
        findingType: 'Info',
        findingSeverity: 'Info',
        functionSignatures: [
          validFunctionSignature,
        ],
        eventSignatures: [
          'event TestEvent(address implementation)'
        ]
      }

      validFunctionHash = web3Eth.abi.encodeFunctionSignature(validFunctionSignature).slice(2);

      proxyPatterns.push(testPattern)
    })

    beforeEach(async () => {
      initializeData = {};

      mockComptrollerContract = {
        getAllMarkets: jest.fn().mockReturnValueOnce([validCTokenAddress]),
      };

      mockedGetContract.mockReturnValueOnce(mockComptrollerContract);

      mockedCTokenContract = {
        underlying: jest.fn().mockReturnValueOnce(validAssetAddress),
        symbol: jest.fn().mockReturnValueOnce(validSymbol),
      };

      mockedGetContract.mockReturnValueOnce(mockedCTokenContract);

      mockedProvider.getCode.mockReturnValueOnce(`0xDEADBEEF${validFunctionHash}DEADBEEF`);

      // initialize the handler
      await (provideInitialize(initializeData))();
      handleTransaction = provideHandleTransaction(initializeData);

      protocolName = initializeData.protocolName;
      protocolAbbreviation = initializeData.protocolAbbreviation;
      developerAbbreviation = initializeData.developerAbbreviation;

      testEventAbi = {
        anonymous: false,
        inputs: [
          {
            indexed: false,
            name: 'implementation',
            type: 'address'
          }
        ],
        name: 'TestEvent',
        type: 'event'
      }
      testEventIFace = new ethers.utils.Interface([testEventAbi]);

      mockTxEvent = createTransactionEvent({
        receipt: {
          logs: []
        },
      });
    });


    it('returns empty findings if no upgrade events were emitted in the transaction', async () => {
      mockComptrollerContract.getAllMarkets.mockReturnValueOnce([])

      const findings = await handleTransaction(mockTxEvent);

      expect(findings).toStrictEqual([]);
    });

    it('returns findings if valid upgrade events were emitted in the transaction', async () => {
      mockComptrollerContract.getAllMarkets.mockReturnValueOnce([])
      
      const override = {
        implementation: validUpgradeAddress,
      }
      
      const testEventAbi = testEventIFace.getEvent('TestEvent');
      const testEvent = createMockEventLogs(testEventAbi, testEventIFace, override);
      const testLog = {
        address: validAssetAddress,
        topics: testEvent.mockTopics,
        args: testEvent.mockArgs,
        data: testEvent.data,
        signature: testEventAbi.format(ethers.utils.FormatTypes.minimal).substring(6)
      }

      mockTxEvent.receipt.logs.push(testLog);

      const findings = await handleTransaction(mockTxEvent);
      const expectedFinding = createUpgradeAlert(
        protocolName,
        protocolAbbreviation,
        developerAbbreviation,
        validSymbol,
        validCTokenAddress,
        validAssetAddress,
        {...testEvent.mockArgs, 0: validUpgradeAddress},
        'Info',
        'Info'
      );

      expect(findings).toStrictEqual([expectedFinding]);
    });


    it('returns no findings if cToken was added but no upgrade events were emitted in the transaction', async () => {
      let newCTokenAddress = `0x2${'0'.repeat(39)}`;
      let newAssetAddress = `0x6${'0'.repeat(39)}`;
      let newSymbol = 'NEWTEST';

      mockComptrollerContract.getAllMarkets.mockReturnValueOnce([newCTokenAddress])

      mockedCTokenContract = {
        underlying: jest.fn().mockReturnValueOnce(newAssetAddress),
        symbol: jest.fn().mockReturnValueOnce(newSymbol),
      };

      mockedGetContract.mockReturnValueOnce(mockedCTokenContract);

      mockedProvider.getCode.mockReturnValueOnce(`0xDEADBEEF${validFunctionHash}DEADBEEF`);      

      const findings = await handleTransaction(mockTxEvent);

      expect(findings).toStrictEqual([]);
    });

    it('returns findings if cToken was added and upgrade events were emitted in the transaction', async () => {
      let newCTokenAddress = `0x2${'0'.repeat(39)}`;
      let newAssetAddress = `0x6${'0'.repeat(39)}`;
      let newSymbol = 'NEWTEST';

      mockComptrollerContract.getAllMarkets.mockReturnValueOnce([newCTokenAddress])

      mockedCTokenContract = {
        underlying: jest.fn().mockReturnValueOnce(newAssetAddress),
        symbol: jest.fn().mockReturnValueOnce(newSymbol),
      };

      mockedGetContract.mockReturnValueOnce(mockedCTokenContract);

      mockedProvider.getCode.mockReturnValueOnce(`0xDEADBEEF${validFunctionHash}DEADBEEF`);      

      const override = {
        implementation: validUpgradeAddress,
      }
      
      const testEventAbi = testEventIFace.getEvent('TestEvent');
      const testEvent = createMockEventLogs(testEventAbi, testEventIFace, override);
      const testLog = {
        address: newAssetAddress,
        topics: testEvent.mockTopics,
        args: testEvent.mockArgs,
        data: testEvent.data,
        signature: testEventAbi.format(ethers.utils.FormatTypes.minimal).substring(6)
      }

      mockTxEvent.receipt.logs.push(testLog);

      const findings = await handleTransaction(mockTxEvent);
      const expectedFinding = createUpgradeAlert(
        protocolName,
        protocolAbbreviation,
        developerAbbreviation,
        newSymbol,
        newCTokenAddress,
        newAssetAddress,
        {...testEvent.mockArgs, 0: validUpgradeAddress},
        'Info',
        'Info'
      );

      expect(findings).toStrictEqual([expectedFinding]);
    });
  });
});

// DEFENDER FORTA SENTINEL AUTOTASK TESTING //

// grab the existing keys before loading new content from the .env file
const existingKeys = Object.keys(process.env);
require('dotenv').config();

// now filter out all of the existing keys from what is currently in the process.env Object
const newKeys = Object.keys(process.env).filter((key) => existingKeys.indexOf(key) === -1);
const secrets = {};
newKeys.forEach((key) => {
  secrets[key] = process.env[key];
});

const autotaskConfig = require('../development-config.json');

const { jsonRpcUrl } = autotaskConfig;

const cTokenSymbol = 'AAVE'

const mockFortaAlert = {
  data: {
    alerts: {
      pageInfo: {
        hasNextPage: false,
        endCursor: {
          alertId: 'AE-COMP-CTOKEN-ASSET-UPGRADED',
          blockNumber: 0
        }
      },
      alerts: [
        {
          createdAt: '2022-03-31T22:02:20.812799122Z',
          name: 'Compound cToken Asset Upgraded',
          protocol: 'Compound',
          findingType: 'INFORMATION',
          // "hash": "0xcee8d4bd1c065260acdcfa51c955fc29c984145de2769b685f29701b6edf318f",
          source: {
            transactionHash: '0xaaec8f4fcb423b5190b8d78b9595376ca34aee8a50c7e3250b3a9e79688b734b',
            block: {
              number: 14496506,
              chainId: 1
            },
            agent: {
              id: '0x3f02bee8b17edc945c5c1438015aede79225ac69c46e9cd6cff679bb71f35576'
            }
          },
          severity: 'INFO',
          metadata: {
            cTokenSymbol: 'AAVE',
            cTokenAddress: '0xAC6A6388691F564Cb69e4082E2bd4e347A978bF9', // fill this in
            underlyingAssetAddress: '0xAC6A6388691F564Cb69e4082E2bd4e347A978bF6' // fill this in
          },
          description: `The underlying asset for the ${cTokenSymbol} cToken contract was upgraded`
        }
      ]
    }
  }
};
  
// create a provider that will be injected as the Defender Relayer provider
const mockProvider = new ethers.providers.JsonRpcBatchProvider(jsonRpcUrl);
jest.mock('defender-relay-client/lib/ethers', () => ({
  DefenderRelayProvider: jest.fn().mockReturnValue(mockProvider),
}));

const axios = require('axios');

jest.mock('axios', () => {
  post: jest.fn().mockResolvedValue(mockFortaAlert.data.alerts.alerts)
})

const { handler } = require('./autotask');

const getFortaAlerts = jest.fn();
getFortaAlerts.mockResolvedValue(mockFortaAlert.data.alerts.alerts);

async function createFortaSentinelEvents(agentId, startBlockNumber, endBlockNumber) {
  const alerts = await getFortaAlerts(agentId, startBlockNumber, endBlockNumber);
  const autotaskEvents = alerts.map((alert) => {
    // augment the alert Object with additional fields
    // admittedly, there is some hand-waving here because we have to mock some of the Sentinel
    // fields that don't originate from the Forta Public API
    // e.g. We have to specify the alertId in the Sentinel to perform filtering on what we get from
    // the Forta Agent in the first place.
    /* eslint-disable no-param-reassign */
    alert.source.agent.name = 'N/A';
    alert.source.block.chain_id = alert.source.block.chainId;
    alert.source.tx_hash = alert.source.transactionHash;
    alert.alertType = 'TX';
    alert.alert_id = 'ALERT_ID_PLACEHOLDER';
    alert.type = 'INFORMATION';
    alert.scanner_count = 1;
    /* eslint-enable no-param-reassign */

    // populate the matchReasons Array with placeholders
    const matchReasons = [
      {
        type: 'alert-id',
        value: 'ALERT_ID_PLACEHOLDER',
      },
      {
        type: 'severity',
        value: 'INFO',
      },
    ];

    // populate the sentinel Object with placeholders
    // none of these are currently checked by any Autotasks in use
    const sentinel = {
      id: '8fe3d50b-9b52-44ff-b3fd-a304c66e1e56',
      name: 'Sentinel Name Placeholder',
      addresses: [],
      agents: [agentId],
      network: 'mainnet',
      chainId: 1,
    };

    const autotaskEvent = {
      relayerARN: undefined,
      kvstoreARN: undefined,
      credentials: undefined,
      tenantId: undefined,
      secrets,
      request: {
        body: {
          hash: alert.hash, // forta Agent hash
          alert,
          matchReasons,
          sentinel,
          type: 'FORTA',
        },
      },
    };
    return autotaskEvent;
  });

  return autotaskEvents;
}

it ('get forta alerts', async() => {
  let alerts = await getFortaAlerts('0x3f02bee8b17edc945c5c1438015aede79225ac69c46e9cd6cff679bb71f35576', 14517164, 14569190)
  console.log('test forta alerts return value', alerts)
})

it('Runs autotask against blocks in configuration file', async () => {
  // get the development configuration values
  const { agentId, startBlockNumber, endBlockNumber } = autotaskConfig;

  // grab Forta Agent alerts from the Forta Public API and create autotaskEvents
  const autotaskEvents = await createFortaSentinelEvents(agentId, startBlockNumber, endBlockNumber);

  // run the autotask on the events
  const promises = autotaskEvents.map((autotaskEvent) => handler(autotaskEvent));

  await Promise.all(promises);
});