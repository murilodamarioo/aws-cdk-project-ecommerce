import * as cdk from 'aws-cdk-lib'
import * as apigatewayv2 from '@aws-cdk/aws-apigatewayv2-alpha'
import * as apigatewayv2_integrations from '@aws-cdk/aws-apigatewayv2-integrations-alpha'
import * as lambdaNodeJS from 'aws-cdk-lib/aws-lambda-nodejs'
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as  s3n from 'aws-cdk-lib/aws-s3-notifications'
import { Construct } from 'constructs'

export class InvoiceWSApiStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props)

        // Invoice and Invoice Transaction DDB

        // Invoice bucket

        // WebSocket connection handler

        // WebSocket disconnection handler

        // WebSocket API

        // Invoice URL handler

        // Cancel import handler

        // WebSocket API routes
    }
}