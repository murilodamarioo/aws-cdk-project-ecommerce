import { DocumentClient } from 'aws-sdk/clients/dynamodb'

import { v4 as uuid } from 'uuid'

export interface OrderProduct {
    code: string,
    price: number
}

export interface Order {
    pk: string,
    sk?: string,
    createdAt?: number,
    shipping: {
        type: 'URGENT' | 'ECONOMIC',
        carrier: 'CORREIOS' | 'SEDEX'
    },
    billing: {
        payment: 'CASH' | 'DEBIT_CARD' | 'CREDIT_CARD',
        totalPrice: number
    },
    products: OrderProduct[]
}


export class OrderRepository {
    private dynamoDbClient: DocumentClient
    private ordersDynamoDb: string

    constructor(dynamoClient: DocumentClient, orderDynamoDb: string) {
        this.dynamoDbClient = dynamoClient
        this.ordersDynamoDb = orderDynamoDb
    }

    async createOrder(order: Order): Promise<Order> {
        order.sk = uuid()
        order.createdAt = Date.now()

        await this.dynamoDbClient.put({
            TableName: this.ordersDynamoDb,
            Item: order
        }).promise()

        return order
    }

    async getAllOrders(): Promise<Order[]> {
        const data = await this.dynamoDbClient.scan({
            TableName: this.ordersDynamoDb,
        }).promise()

        return data.Items as Order[]
    }
}