import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda'

const __dirname = dirname(fileURLToPath(import.meta.url))

const DEFAULT_CASES_FILE = resolve(__dirname, 'strands-intent-classifier-evaluated-cases.json')

const parseArgs = (argv = []) => {
  const args = {
    casesFile: DEFAULT_CASES_FILE,
    lambdaName: process.env.STRANDS_INTENT_CLASSIFIER_LAMBDA_NAME,
    outputFile: null,
    region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1',
    failFast: false
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--cases') args.casesFile = resolve(process.cwd(), argv[++index])
    else if (arg === '--lambda-name') args.lambdaName = argv[++index]
    else if (arg === '--output') args.outputFile = resolve(process.cwd(), argv[++index])
    else if (arg === '--region') args.region = argv[++index]
    else if (arg === '--fail-fast') args.failFast = true
    else if (arg === '--help' || arg === '-h') args.help = true
  }

  return args
}

const printHelp = () => {
  console.log(`Usage:
  node evaluation/evaluate-strands-intent-classifier.mjs --lambda-name <lambda-name>

Options:
  --lambda-name  Deployed strandsIntentClassifier Lambda name. Can also use STRANDS_INTENT_CLASSIFIER_LAMBDA_NAME.
  --cases        Path to validation cases JSON. Defaults to evaluation/strands-intent-classifier-evaluated-cases.json.
  --output       Optional path to write a JSON evaluation report.
  --region       AWS region. Defaults to AWS_REGION, AWS_DEFAULT_REGION, then us-east-1.
  --fail-fast    Stop on first failing case.
`)
}

const loadCases = (casesFile) => {
  const cases = JSON.parse(readFileSync(casesFile, 'utf8'))
  if (!Array.isArray(cases)) throw new Error('Cases file must contain a JSON array.')
  return cases
}

const buildLambdaPayload = (testCase) => ({
  recipient: {
    messageBody: testCase.message,
    channel: testCase.channel || 'whatsapp',
    destinationAddress: testCase.destinationAddress || '+2250000000000',
    serviceAddress: testCase.serviceAddress || '+2250701073000',
    senderName: testCase.senderName || 'Evaluation Prospect'
  },
  conversation: testCase.conversation || [],
  sessionVariables: {
    useCaseId: 'agent',
    channel: testCase.channel || 'whatsapp',
    sessionId: testCase.sessionId || `evaluation-${testCase.id}`,
    ...(testCase.sessionVariables || {})
  },
  useCase: {
    useCase: 'agent',
    modelId: testCase.modelId || 'amazon.nova-lite-v1:0',
    ...(testCase.useCase || {})
  }
})

const invokeClassifier = async (lambdaClient, lambdaName, testCase) => {
  const command = new InvokeCommand({
    FunctionName: lambdaName,
    InvocationType: 'RequestResponse',
    Payload: Buffer.from(JSON.stringify(buildLambdaPayload(testCase)))
  })

  const response = await lambdaClient.send(command)
  const payloadText = Buffer.from(response.Payload || []).toString('utf8')
  const payload = payloadText ? JSON.parse(payloadText) : {}

  if (response.FunctionError) {
    throw new Error(`Lambda returned ${response.FunctionError}: ${payloadText}`)
  }

  return payload.classification || payload
}

const getValue = (object, path) => {
  return path.split('.').reduce((value, key) => value?.[key], object)
}

const valuesMatch = (actual, expected) => {
  if (expected === null) return actual === null || actual === undefined
  if (Array.isArray(expected)) {
    if (Array.isArray(actual)) {
      return expected.every((expectedItem) => actual.includes(expectedItem))
    }
    return expected.includes(actual)
  }
  return actual === expected
}

const valuesConflict = (actual, prohibited) => {
  if (prohibited === null) return actual === null || actual === undefined
  if (Array.isArray(prohibited)) {
    if (Array.isArray(actual)) {
      return prohibited.some((prohibitedItem) => actual.includes(prohibitedItem))
    }
    return prohibited.includes(actual)
  }
  if (Array.isArray(actual)) return actual.includes(prohibited)
  return actual === prohibited
}

const compareClassification = (actual = {}, expected = {}, expectedNot = {}) => {
  const failures = []

  for (const [path, expectedValue] of Object.entries(expected)) {
    const actualValue = getValue(actual, path)
    if (!valuesMatch(actualValue, expectedValue)) {
      failures.push({
        path,
        expected: expectedValue,
        actual: actualValue
      })
    }
  }

  for (const [path, prohibitedValue] of Object.entries(expectedNot)) {
    const actualValue = getValue(actual, path)
    if (valuesConflict(actualValue, prohibitedValue)) {
      failures.push({
        path,
        expected: { not: prohibitedValue },
        actual: actualValue
      })
    }
  }

  return failures
}

const formatValue = (value) => {
  if (value === undefined) return 'undefined'
  return JSON.stringify(value)
}

const writeReport = (outputFile, report) => {
  mkdirSync(dirname(outputFile), { recursive: true })
  writeFileSync(outputFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
}

const run = async () => {
  const args = parseArgs(process.argv.slice(2))

  if (args.help) {
    printHelp()
    return
  }

  if (!args.lambdaName) {
    throw new Error('Missing --lambda-name or STRANDS_INTENT_CLASSIFIER_LAMBDA_NAME.')
  }

  const cases = loadCases(args.casesFile)
  const lambdaClient = new LambdaClient({ region: args.region })
  const results = []

  console.log(`Evaluating ${cases.length} case(s) against ${args.lambdaName} in ${args.region}.`)
  console.log(`Cases: ${args.casesFile}`)

  for (const testCase of cases) {
    try {
      const actual = await invokeClassifier(lambdaClient, args.lambdaName, testCase)
      const failures = compareClassification(actual, testCase.expected || {}, testCase.expectedNot || {})
      const passed = failures.length === 0
      results.push({ testCase, actual, failures, passed })

      const status = passed ? 'PASS' : 'FAIL'
      console.log(`${status} ${testCase.id}: ${testCase.message}`)
      console.log(`  actual: primaryIntent=${actual.primaryIntent}, purchaseStage=${actual.purchaseStage}, shouldNotifySales=${actual.shouldNotifySales}, confidence=${actual.confidence}`)

      for (const failure of failures) {
        console.log(`  mismatch ${failure.path}: expected ${formatValue(failure.expected)}, got ${formatValue(failure.actual)}`)
      }

      if (!passed && args.failFast) break
    } catch (error) {
      results.push({ testCase, error, failures: [{ path: 'lambda', expected: 'success', actual: error.message }], passed: false })
      console.log(`ERROR ${testCase.id}: ${error.message}`)
      if (args.failFast) break
    }
  }

  const passedCount = results.filter((result) => result.passed).length
  const failedCount = results.length - passedCount
  const accuracy = results.length ? (passedCount / results.length) * 100 : 0
  const report = {
    generatedAt: new Date().toISOString(),
    lambdaName: args.lambdaName,
    region: args.region,
    casesFile: args.casesFile,
    summary: {
      total: results.length,
      passed: passedCount,
      failed: failedCount,
      accuracy
    },
    results: results.map((result) => ({
      id: result.testCase.id,
      message: result.testCase.message,
      passed: result.passed,
      expected: result.testCase.expected,
      expectedNot: result.testCase.expectedNot,
      actual: result.actual,
      failures: result.failures,
      error: result.error?.message
    }))
  }

  console.log('')
  console.log(`Summary: ${passedCount}/${results.length} passed (${accuracy.toFixed(1)}%).`)

  if (args.outputFile) {
    writeReport(args.outputFile, report)
    console.log(`Report written to ${args.outputFile}`)
  }

  if (failedCount > 0) {
    console.log(`Failed: ${failedCount}`)
    process.exitCode = 1
  }
}

run().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
