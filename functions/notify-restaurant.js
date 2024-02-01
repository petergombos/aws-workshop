const middy = require("@middy/core");
const {
  EventBridgeClient,
  PutEventsCommand,
} = require("@aws-sdk/client-eventbridge");
const eventBridge = new EventBridgeClient();
const { SNSClient, PublishCommand } = require("@aws-sdk/client-sns");
const sns = new SNSClient();
const { makeIdempotent } = require("@aws-lambda-powertools/idempotency");
const {
  DynamoDBPersistenceLayer,
} = require("@aws-lambda-powertools/idempotency/dynamodb");
const {
  Logger,
  injectLambdaContext,
} = require("@aws-lambda-powertools/logger");
const logger = new Logger({ serviceName: process.env.serviceName });

const busName = process.env.bus_name;
const topicArn = process.env.restaurant_notification_topic;

const persistenceStore = new DynamoDBPersistenceLayer({
  tableName: process.env.idempotency_table,
});

const handler = middy(async (event, context) => {
  logger.refreshSampleRateCalculation();

  const order = event.detail;
  const publishCmd = new PublishCommand({
    Message: JSON.stringify(order),
    TopicArn: topicArn,
  });
  await sns.send(publishCmd);

  const { restaurantName, orderId } = order;
  logger.debug(`restaurant notified`, {
    restaurantName,
    orderId,
  });

  const putEventsCmd = new PutEventsCommand({
    Entries: [
      {
        Source: "big-mouth",
        DetailType: "restaurant_notified",
        Detail: JSON.stringify(order),
        EventBusName: busName,
      },
    ],
  });
  await eventBridge.send(putEventsCmd);

  logger.debug(`published event to EventBridge`, {
    eventType: "restaurant_notified",
    busName,
  });

  return orderId;
}).use(injectLambdaContext(logger));

module.exports.handler = makeIdempotent(handler, { persistenceStore });
