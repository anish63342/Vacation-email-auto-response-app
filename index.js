const express = require("express");
const app = express();
const cors = require("cors");
app.use(express.json(), cors());
const cron = require("node-cron");
const fs = require("fs").promises;
const path = require("path");
const process = require("process");
const { authenticate } = require("@google-cloud/local-auth");
const { google } = require("googleapis");

// Server Check
const port = process.env.PORT || 9000;
app.listen(port, () => {
  console.log("Server is  running up and healthy on " + port);
});

// If modifying these scopes, delete token.json.
const SCOPES = ["https://www.googleapis.com/auth/gmail.modify"];
// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first
// time.
const TOKEN_PATH = path.join(process.cwd(), "token.json");
const CREDENTIALS_PATH = path.join(process.cwd(), "credentials.json");
/**
 * Reads previously authorized credentials from the save file.
 *
 * @return {Promise<OAuth2Client|null>}
 */
async function loadSavedCredentialsIfExist() {
  try {
    const content = await fs.readFile(TOKEN_PATH);
    const credentials = JSON.parse(content);
    return google.auth.fromJSON(credentials);
  } catch (err) {
    return null;
  }
}
/**
 * Serializes credentials to a file compatible with GoogleAUth.fromJSON.
 *
 * @param {OAuth2Client} client
 * @return {Promise<void>}
 */
async function saveCredentials(client) {
  const content = await fs.readFile(CREDENTIALS_PATH);
  const keys = JSON.parse(content);
  const key = keys.installed || keys.web;
  const payload = JSON.stringify({
    type: "authorized_user",
    client_id: key.client_id,
    client_secret: key.client_secret,
    refresh_token: client.credentials.refresh_token,
  });
  await fs.writeFile(TOKEN_PATH, payload);
}
/**
 * Load or request or authorization to call APIs.
 *
 */
async function authorize() {
  let client = await loadSavedCredentialsIfExist();
  if (client) {
    return client;
  }
  client = await authenticate({
    scopes: SCOPES,
    keyfilePath: CREDENTIALS_PATH,
  });
  if (client.credentials) {
    await saveCredentials(client);
  }
  return client;
}

/**
 * Lists unread emails with 0 threads
 *
 * @param {google.auth.OAuth2} auth An authorized OAuth2 client.
 */

const listUnreadEmailsWithZeroThreads = async (auth) => {
  const gmail = google.gmail({ version: "v1", auth });
  // Fetch list of unread emails with 0 threads
  const res = await gmail.users.messages.list({
    userId: "me",
    q: "is:unread AND !in:chats ",
  });
  const messages = res.data.messages || [];
  const unreadMessagesWithOneThread = [];
    console.log(messages)
  for (const message of messages) {
    const messageDetails = await gmail.users.messages.get({
      userId: "me",
      id: message.id,
      format: "full",
    });
    const threadId = messageDetails.data.threadId;
    const thread = await gmail.users.threads.get({
      userId: "me",
      id: threadId,
    });
    if (thread.data.messages.length === 1) {
      console.log(message);
      sendEmailReply(message.id, auth, threadId);
      unreadMessagesWithOneThread.push(messageDetails.data);
    }
  }
};
const sendEmailReply = async (messageId, auth, threadId) => {
    const gmail = google.gmail({ version: "v1", auth });
    if (!messageId) {
      console.error("Error: messageId parameter is missing.");
      return;
    }
    try {
      // Fetch the email message by ID
      const res = await gmail.users.messages.get({
        userId: "me",
        id: messageId,
      });
      const message = res.data;
  
      // Get the email address of the sender
      const headers = message.payload.headers || [];
      let from = "";
      headers.forEach((header) => {
        if (header.name.toLowerCase() === "from") {
          from = header.value;
        }
      });
  
      // Set up the email reply
      const emailMessage = [
        `To: ${from}`,
        `Subject: RE: ${message.payload.headers.find(
          (header) => header.name === "Subject"
        ).value}`,
        `In-Reply-To: ${messageId}`,
        `References: ${messageId} <${message.threadId}@mail.gmail.com>`,
        "",
        "This is an automated reply to your email. Thank you for reaching out!",
      ].join("\n");
  
      // Send the email reply
      const response = await gmail.users.messages.send({
        userId: "me",
        resource: {
            threadId: message.threadId,
            raw: Buffer.from(emailMessage).toString('base64')
          }
    
      });
      console.log(response);
  
      // Mark the original email as read
      await gmail.users.messages.modify({
        userId: "me",
        id: messageId,
        removeLabelIds: ["UNREAD"],
      });

    
       // Move the original email to "vacation" label
    await gmail.users.messages.modify({
        userId: "me",
        id: messageId,
        addLabelIds: ["Label_4802265378578522197"],
        removeLabelIds: ["UNREAD","INBOX"],
      });
    } catch (err) {
      console.error("Error sending email reply:", err);
    }
  };



const job = cron.schedule('*/5 * * * * *', async () => {
  try {
    await authorize().then(listUnreadEmailsWithZeroThreads).catch(console.error);
  } catch (err) {
    console.error(err);
  }
});
job.start();

