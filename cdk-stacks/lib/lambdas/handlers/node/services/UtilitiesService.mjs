import { ConversationRole } from "@aws-sdk/client-bedrock-runtime";

export function formatAnthropicConversation (conversation) {
    let formattedConversation = []
    for (let i = 0; i < conversation.length; i++) {
        if (conversation[i].direction === "outbound") {
            formattedConversation.push({"role": ConversationRole.ASSISTANT, "content": conversation[i].message});
        } else {
            formattedConversation.push({"role": ConversationRole.USER, "content": conversation[i].message});
        }
    }
    return formattedConversation;
}

export function formatAmazonConversation (conversation) {
    let formattedConversation = []
    for (let i = 0; i < conversation.length; i++) {
        if (conversation[i].direction === "outbound") {
            formattedConversation.push({"role": ConversationRole.ASSISTANT, "content": [{"text": conversation[i].message}]});
        } else {
            formattedConversation.push({"role": ConversationRole.USER, "content": [{"text": conversation[i].message}]});
        }
    }
    return formattedConversation;
}