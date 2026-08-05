"""Custom Resource handler that waits for an AgentCore Runtime to reach READY status."""
import json
import time
import urllib.request
import boto3


def handler(event, context):
    response_url = event['ResponseURL']
    request_type = event['RequestType']
    physical_id = event.get('PhysicalResourceId', 'wait-for-runtime')

    try:
        if request_type == 'Delete':
            send_response(response_url, event, 'SUCCESS', physical_id)
            return

        runtime_id = event['ResourceProperties']['RuntimeId']
        region = event['ResourceProperties'].get('Region', 'us-east-1')

        client = boto3.client('bedrock-agentcore-control', region_name=region)

        max_wait = 300  # 5 minutes
        interval = 10
        elapsed = 0

        while elapsed < max_wait:
            try:
                resp = client.get_agent_runtime(agentRuntimeId=runtime_id)
                status = resp.get('status', 'UNKNOWN')
            except Exception:
                status = 'UNKNOWN'

            if status == 'READY':
                send_response(response_url, event, 'SUCCESS', physical_id,
                              {'RuntimeId': runtime_id, 'Status': status})
                return

            if status == 'FAILED':
                reason = resp.get('failureReason', 'Unknown failure')
                send_response(response_url, event, 'FAILED', physical_id,
                              reason=f'Runtime failed: {reason}')
                return

            time.sleep(interval)
            elapsed += interval

        send_response(response_url, event, 'FAILED', physical_id,
                      reason=f'Timed out waiting for runtime {runtime_id} (last status: {status})')

    except Exception as e:
        send_response(response_url, event, 'FAILED', physical_id, reason=str(e))


def send_response(url, event, status, physical_id, data=None, reason=''):
    body = json.dumps({
        'Status': status,
        'Reason': reason or 'See CloudWatch logs',
        'PhysicalResourceId': physical_id,
        'StackId': event['StackId'],
        'RequestId': event['RequestId'],
        'LogicalResourceId': event['LogicalResourceId'],
        'Data': data or {},
    }).encode()

    req = urllib.request.Request(url, data=body, method='PUT')
    req.add_header('Content-Type', '')
    req.add_header('Content-Length', str(len(body)))
    urllib.request.urlopen(req)
