const express = require('express');
const { Client } = require('pg');
const twilio = require('twilio');
const { WebClient } = require('@slack/web-api');
const cron = require('node-cron');
const cors = require('cors');
require('dotenv').config();

//setup express app
const app = express();
const port = 3000;

//setup middleware
app.use(cors()); //use CORS to allow cross-origin requests
app.use(express.json()); //use JSON middleware to parse incoming JSON requests

//setup PostgreSQL
const dbClient = new Client({
    connectionString: process.env.DATABASE_URL,
});

dbClient.connect()
  .then(() => console.log('Connected to PostgreSQL'))
  .catch(err => console.error('Connection error', err.stack));

//setup Twilio (for SMS)
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

const sendSMS = (to, message) => {
  return twilioClient.messages.create({
    body: message,
    from: process.env.TWILIO_PHONE_NUMBER,
    to: to
  });
};

//setup Slack client
const slackClient = new WebClient(process.env.SLACK_TOKEN);

const sendSlackMessage = (channel, text) => {
  return slackClient.chat.postMessage({
    channel: channel,
    text: text
  });
};

//API endpoints
app.post('/addMember', async (req, res) => {
  const { name, phoneNumber, slackUsername } = req.body;
  try {
    await dbClient.query('INSERT INTO members (name, phoneNumber, slackUsername) VALUES ($1, $2, $3)', [name, phoneNumber, slackUsername]);
    res.status(201).send('Member added');
  } catch (error) {
    console.error('Error adding member:', error);
    res.status(500).send('Error adding member');
  }
});
  
app.post('/scheduleReminder', async (req, res) => {
    const { message, time } = req.body;
    try {
      await dbClient.query('INSERT INTO reminders (message, time) VALUES ($1, $2)', [message, time]);
      res.send('Reminder scheduled');
    } catch (error) {
      console.error('Error adding reminder:', error);
      res.status(500).send('Error adding reminder');
    }
});
  
app.get('/members', async (req, res) => {
  try {
    const result = await dbClient.query('SELECT * FROM members');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching members:', error);
    res.status(500).send('Error fetching members');
  }
});
  
app.get('/reminders', async (req, res) => {
  try {
    const result = await dbClient.query('SELECT * FROM reminders');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching reminders:', error);
    res.status(500).send('Error fetching reminders');
  }
});

//cron job for scheduling reminders
cron.schedule('0 8 * * *', async () => { // '0 8 * * *' schedules job to run every day at 8:00am
    const now = new Date();

    try {
      const reminders = await dbClient.query('SELECT * FROM reminders WHERE time > $1', [now]); //all future reminders
  
      for (const reminder of reminders.rows) {
        const members = await dbClient.query('SELECT * FROM members');

        members.rows.forEach(async member => {
          if (member.phoneNumber) { //if phone number exists, send an SMS reminder
            await sendSMS(member.phoneNumber, reminder.message);
          } else { //if no phone number exists, use slack DM
              if (member.slackUsername) {
                await sendSlackMessage(member.slackUsername, reminder.message);
              }
          }
        });
      }
    } catch (error) {
      console.error('Error sending reminders:', error);
    }
  });

//start server
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}/`);
});