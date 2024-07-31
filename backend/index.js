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
dbClient.connect();

//setup Twilio (for SMS)
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

//setup Slack client
const slackClient = new WebClient(process.env.SLACK_TOKEN);

//API endpoints
app.post('/addMember', async (req, res) => {
    const { name, phoneNumber, slackUsername } = req.body;
    await dbClient.query('INSERT INTO members (name, phoneNumber, slackUsername) VALUES ($1, $2, $3)', [name, phoneNumber, slackUsername]);
    res.send('Member added');
});
  
app.post('/scheduleReminder', async (req, res) => {
    const { message, time } = req.body;
    await dbClient.query('INSERT INTO reminders (message, time) VALUES ($1, $2)', [message, time]);
    res.send('Reminder scheduled');
});
  
app.get('/members', async (req, res) => {
    const result = await dbClient.query('SELECT * FROM members');
    res.json(result.rows);
});
  
app.get('/reminders', async (req, res) => {
    const result = await dbClient.query('SELECT * FROM reminders');
    res.json(result.rows);
});

//cron job for scheduling reminders
cron.schedule('0 8 * * *', async () => { // '0 8 * * *' schedules job to run every day at 8:00am
    const now = new Date();
    const reminders = await dbClient.query('SELECT * FROM reminders WHERE time > $1', [now]); //all future reminders
  
    for (const reminder of reminders.rows) {
      const members = await dbClient.query('SELECT * FROM members');

      members.rows.forEach(member => {
        if (member.phoneNumber) { //if phone number exists, send an SMS reminder
          twilioClient.messages.create({
            body: reminder.message,
            from: process.env.TWILIO_PHONE_NUMBER,
            to: member.phoneNumber,
          });
        } else { //if no phone number exists, use slack DM
            if (member.slackUsername) {
                slackClient.chat.postMessage({
                  channel: member.slackUsername,
                  text: reminder.message,
                });
              }
        }
      });
    }
  });

//start server
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}/`);
});