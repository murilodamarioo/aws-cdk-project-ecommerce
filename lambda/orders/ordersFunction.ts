import { Order, OrderRepository } from '/opt/nodejs/ordersLayer'
import { Product, ProductRepository } from '/opt/nodejs/productsLayer'
import { DynamoDB, EventBridge, SNS } from 'aws-sdk'
import { APIGatewayProxyEvent, APIGatewayProxyResultV2, Context } from 'aws-lambda'
import { CarrierType, OrderProductResponse, OrderRequest, OrderResponse, PaymentType, ShippingType } from './layers/ordersApiLayer/nodejs/orderApi'
import * as AWSXRay from 'aws-xray-sdk'
import { OrderEvent, OrderEventType, Envelope } from '/opt/nodejs/orderEventsLayer'
import { v4 as uuid } from 'uuid'

AWSXRay.captureAWS(require('aws-sdk'))

const ordersDynamoDB = process.env.ORDERS_DDB!
const productsDynamoDb = process.env.PRODUCTS_DDB!
const orderEventsTopicArn = process.env.ORDER_EVENTS_TOPIC_ARN!
const auditBusName = process.env.AUDIT_BUS_NAME!


const dynamoDbClient = new DynamoDB.DocumentClient()
const snsClient = new SNS()
const eventBrigdeClient = new EventBridge()

const orderRepository = new OrderRepository(dynamoDbClient, ordersDynamoDB)
const productRepository = new ProductRepository(dynamoDbClient, productsDynamoDb)


export async function handler(event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResultV2> {
    const method = event.httpMethod
    const apiRequestId = event.requestContext.requestId
    const lambdaRequestId = context.awsRequestId

    console.log(`API Gateway ResquestId: ${apiRequestId} - LambdaRequestId: ${lambdaRequestId}`)

    console.log(`Event: ${JSON.stringify(event.body)}`)

    if(method === 'GET') {
        if (event.queryStringParameters) {
            const email = event.queryStringParameters!.email
            const orderId = event.queryStringParameters!.orderId

            if (email) {
                if(orderId) {
                    // Get one order from an user
                    try {
                        const order = await orderRepository.getOrder(email, orderId)

                        return {
                            statusCode: 200,
                            body: JSON.stringify(convertToOrderResponse(order))
                        }
                    } catch (error) {
                        console.log((<Error>error).message)

                        return {
                            statusCode: 404,
                            body: (<Error>error).message
                        }
                    }
                } else {
                    // Get all order from an user
                    const orders = await orderRepository.getOrdersByEmail(email)

                    return {
                        statusCode: 200,
                        body: JSON.stringify(orders.map(convertToOrderResponse))
                    }
                }
            }
        } else {
            // Get all orders 
            const orders = await orderRepository.getAllOrders()

            return {
                statusCode: 200,
                body: JSON.stringify(orders.map(convertToOrderResponse))
            }
        }
    } else if (method === 'POST') {
        console.log('POST - /orders')

        const orderRequest = JSON.parse(event.body!) as OrderRequest
        const products = await productRepository.getProductsByIds(orderRequest.productIds)

        if (products.length === orderRequest.productIds.length) {
            const order = buildOrder(orderRequest, products)

            const orderCreatePromise = orderRepository.createOrder(order)
            const eventResultPromise = sendOrderEvent(order, OrderEventType.CREATED, lambdaRequestId)

            const results = await Promise.all([orderCreatePromise, eventResultPromise])
            console.log(`Order created event sent - OrderId: ${order.sk} - MessageId: ${results[1].MessageId}`)

            return {
                statusCode: 201,
                body: JSON.stringify(convertToOrderResponse(order))
            }
        } else {
            console.error('Some product was not found')
            
            const result = await eventBrigdeClient.putEvents({
                Entries: [
                    {
                        Source: 'app.order',
                        EventBusName: auditBusName,
                        DetailType: 'order',
                        Time: new Date(),
                        Detail: JSON.stringify({
                            reason: 'PRODUCT_NOT_FOUND',
                            orderRequest: orderRequest
                        })
                    }
                ]
            }).promise()

            console.log(result)
            return {
                statusCode: 404,
                body: 'Some product was not found'
            }
        }
    } else if (method === 'DELETE') {
        console.log('DELETE - /orders')

        try {
            const email = event.queryStringParameters!.email!
            const orderId = event.queryStringParameters!.orderId!

            const orderDeleted = await orderRepository.deleteOrder(email, orderId)

            const eventResult = await sendOrderEvent(orderDeleted, OrderEventType.DELETED, lambdaRequestId)
            console.log(`Order deleted event sent - OrderId: ${orderDeleted.sk} - MessageId: ${eventResult.MessageId}`)

            return {
                statusCode: 200,
                body: JSON.stringify(convertToOrderResponse(orderDeleted))
            }
        } catch (error) {
            console.log((<Error>error).message)

            return {
                statusCode: 404,
                body: (<Error>error).message
            }
        }
    }

    return {
        statusCode: 400,
        body: 'Bad Request'
    }
}

function convertToOrderResponse(order: Order): OrderResponse {
    const orderProducts: OrderProductResponse[] = []

    order.products?.forEach((product) => {
        orderProducts.push({
            code: product.code,
            price: product.price
        })
    })
    
    const orderResponse: OrderResponse = {
        email: order.pk,
        id: order.sk!,
        createdAt: order.createdAt!,
        products: orderProducts.length ? orderProducts : undefined,
        billing: {
            payment: order.billing.payment as PaymentType,
            totalPrice: order.billing.totalPrice
        },
        shipping: {
            type: order.shipping.type as ShippingType,
            carrier: order.shipping.carrier as CarrierType
        }
    }

    return orderResponse
}

function buildOrder(orderRequest: OrderRequest, products: Product[]): Order {
    const orderProducts: OrderProductResponse[] = []
    let totalPrice: number = 0

    products.forEach((product) => {
        totalPrice += product.price
        orderProducts.push({
            code: product.code,
            price: product.price
        })
    })

    const order: Order = {
        pk: orderRequest.email,
        sk: uuid(),
        createdAt: Date.now(),
        billing: {
            payment: orderRequest.paymentType,
            totalPrice: totalPrice
        },
        shipping: {
            type: orderRequest.shipping.type,
            carrier: orderRequest.shipping.carrier
        },
        products: orderProducts
    }

    return order
}

function sendOrderEvent(order: Order, eventType: OrderEventType, lambdaRequestId: string) {
    const productCodes: string[] = []
    order.products?.forEach((product) => {
        productCodes.push(product.code)
    })
    
    const orderEvent: OrderEvent = {
        email: order.pk,
        orderId: order.sk!,
        billing: order.billing,
        shipping: order.shipping,
        requestId: lambdaRequestId,
        productCodes: productCodes
    }
    
    const envelope: Envelope = {
        eventType: eventType,
        data: JSON.stringify(orderEvent)
    }

    return snsClient.publish({
        TopicArn: orderEventsTopicArn,
        Message: JSON.stringify(envelope),
        MessageAttributes: {
            eventType: {
                DataType: 'String',
                StringValue: eventType
            }
        }
    }).promise()
}