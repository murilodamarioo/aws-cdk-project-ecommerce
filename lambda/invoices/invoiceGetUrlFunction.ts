import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from "aws-lambda";
import { ApiGatewayManagementApi, DynamoDB, S3 } from "aws-sdk";
import * as AWSXRay from 'aws-xray-sdk'
import { v4 as uuid } from 'uuid'
import { InvoiceTransactionStatus, InvoiceTransactionRepository } from '/opt/nodejs/invoiceTransaction'
import { InvoiceWSService } from '/opt/nodejs/invoiceWSConnection'

AWSXRay.captureAWS(require('aws-sdk'))

const invoicesDdb = process.env.INVOICE_DDB!
const bucketName = process.env.BUCKET_NAME!
const invoicesWSApiEndPoint = process.env.INVOICE_WSAPI_ENDPOINT!.substring(6)

const s3Client = new S3()
const dynamoDbClient = new DynamoDB.DocumentClient()
const  apigwManagementApi = new ApiGatewayManagementApi({
    endpoint: invoicesWSApiEndPoint
})

const invoiceTransactionRepository = new InvoiceTransactionRepository(dynamoDbClient, invoicesDdb)
const invoiceWSService = new InvoiceWSService(apigwManagementApi)

export async function handler(event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> {
    console.log(event)
 
    const lambdaRequestId = context.awsRequestId
    const connectionId = event.requestContext.connectionId!

    console.log(`ConnectionId: ${connectionId} - Lambda RequestI: ${lambdaRequestId}`)

    const key = uuid()
    const expires = 300

    const signedUrlPut = await s3Client.getSignedUrlPromise('putObject', {
        Bucket: bucketName,
        Key: key,
        Expires: expires
    })

    // Create invoice transaction
    const timestamp = Date.now()
    const ttl = ~~(timestamp / 1000 + 60 * 2)
    await invoiceTransactionRepository.createInvoiceTransaction({
        pk: '#transaction',
        sk: key,
        ttl: ttl,
        requestId: lambdaRequestId,
        transactionStatus: InvoiceTransactionStatus.GENERATED,
        timestamp: timestamp,
        expiresIn: expires,
        connectionId: connectionId,
        endpoint: invoicesWSApiEndPoint
    })
    // Send URL back to WS connect client
    const postData = JSON.stringify({
        url: signedUrlPut,
        expires: expires,
        transactionId: key
    })
    await invoiceWSService.sendData(connectionId, postData)

    return {
        statusCode: 200,
        body: 'OK'
    }
}