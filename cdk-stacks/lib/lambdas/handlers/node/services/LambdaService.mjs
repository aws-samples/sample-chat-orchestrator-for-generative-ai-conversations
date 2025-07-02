import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda'
const lambdaClient = new LambdaClient({})

export async function invoke(functionName, payload) {
        try {
            const command = new InvokeCommand({ FunctionName: functionName, InvocationType: 'RequestResponse', Payload: JSON.stringify(payload) })
            const response = await lambdaClient.send(command)
            return JSON.parse(new TextDecoder().decode(response.Payload))
        } catch (error) {
        console.error(error)
        throw error
    }
}
