const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());

const DATASET_URL = 'https://candidate.hubteam.com/candidateTest/v3/problem/dataset?userKey=0f7f2e5d805e90d27e4b3c76cf90';
const SUBMIT_URL = 'https://candidate.hubteam.com/candidateTest/v3/problem/result?userKey=0f7f2e5d805e90d27e4b3c76cf90';

function splitCalls(calls) {
  const splitCallsArray = [];

  calls.forEach(call => {
    const startDate = new Date(call.startTimestamp);
    const endDate = new Date(call.endTimestamp);

    if (startDate.toISOString().split('T')[0] !== endDate.toISOString().split('T')[0]) {
      splitCallsArray.push({
        ...call,
        endTimestamp: new Date(endDate.toISOString().split('T')[0])
      });
      splitCallsArray.push({
        ...call,
        startTimestamp: new Date(endDate.toISOString().split('T')[0])
      });
    } else {
      splitCallsArray.push(call);
    }
  });

  return splitCallsArray;
}

const calculateMaxConcurrentCalls = (calls) => {
  const events = [];

  calls.forEach(call => {
    events.push({ time: call.startTimestamp, type: 'start', id: call.callId });
    events.push({ time: call.endTimestamp, type: 'end', id: call.callId });
  });

  events.sort((a, b) => {
    if (a.time === b.time) {
      return a.type === 'end' ? -1 : 1;
    }
    return a.time - b.time;
  });

  let currentCount = 0;
  let maxCount = 0;
  let activeCalls = new Set();
  let maxCalls = new Set();
  let maxStartTime = 0;
  let maxEndTime = 0;

  events.forEach(event => {
    if (event.type === 'start') {
      currentCount++;
      activeCalls.add(event.id);

      if (currentCount > maxCount) {
        maxCount = currentCount;
        maxCalls = new Set(activeCalls);
        maxStartTime = event.time;
      } else if (currentCount === maxCount) {
        maxEndTime = event.time;
      }
    } else {
      if (currentCount === maxCount) {
        maxEndTime = event.time;
      }

      currentCount--;
      activeCalls.delete(event.id);
    }
  });

  return [
    maxCount,
    Array.from(maxCalls),
    maxStartTime
  ];
};

app.post('/process-calls', async (req, res) => {
    try {
        const response = await axios.get(DATASET_URL);
        const {callRecords: calls} = response.data;

        const results = {};

        const splitedCalls = splitCalls(calls);

        splitedCalls.forEach(call => {
            const date = new Date(call.startTimestamp).toISOString().split('T')[0];
            const customerId = call.customerId;

            if (!results[customerId]) {
                results[customerId] = {};
            }

            if (!results[customerId][date]) {
                results[customerId][date] = {
                    maxConcurrentCalls: 0,
                    timestamp: null,
                    callIds: []
                };
            }

            results[customerId][date].callIds.push(call.callId);
            const [maxCount, callIDs, period] = calculateMaxConcurrentCalls(splitedCalls.filter(c => {
                const callDate = new Date(c.startTimestamp).toISOString().split('T')[0];
                return callDate === date && c.customerId === customerId;
            }));
            results[customerId][date].maxConcurrentCalls = maxCount;
            results[customerId][date].timestamp = period;
            results[customerId][date].callIds = callIDs;
        });

        const formattedResults = Object.entries(results).flatMap(([customerId, dates]) =>
            Object.entries(dates).map(([date, data]) => ({
                customerId: parseInt(customerId),
                date: date,
                maxConcurrentCalls: data.maxConcurrentCalls,
                timestamp: data.timestamp,
                callIds: data.callIds
            }))
        );

        const result = await axios.post(SUBMIT_URL, {results: formattedResults}, {
          headers: {
            'Content-Type': 'application/json'
          }
        });

        if (result.status === 200) {
          return res.json({success: true, data: result.data});
        }
        console.log('res.data', result.data);
        return res.status(500).json({ error: 'An error occurred' });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'An error occurred while processing calls.' });
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
