const express = require('express')
const bodyParser = require('body-parser')
const request = require('request')
const app = express()
const Cosmic = require('cosmicjs')
const BootBot = require('bootbot')
require('dotenv').config()
const chrono = require('chrono-node')
var schedule = require('node-schedule')
const EventEmitter = require('events').EventEmitter

var config = {}

const reminders = []

const eventEmitter = new EventEmitter()

app.set('port', (process.env.PORT || 5000))
app.use(bodyParser.urlencoded({extended: false}))
app.use(bodyParser.json())

app.get('/', function(req, res) {
  res.send("hey there boi")
})

app.get('/webhook/', function(req, res) {
  if (req.query['hub.verify_token'] === process.env.VERIFY_TOKEN){
    return res.send(req.query['hub.challenge'])
  }
  res.send('wrong token')
})

app.listen(app.get('port'), function(){
  console.log('Started on port', app.get('port'))
})

// This creates an object that talks to the bootbot npm package. This allows us to use webhooks and such things
const bot = new BootBot({
  accessToken: process.env.ACCESS_TOKEN,
  verifyToken: process.env.VERIFY_TOKEN,
  appSecret: process.env.APP_SECRET
})

// This shows you a nice little message before you decide to message the Facebook page
bot.setGreetingText("Hello, I'm here to help you manage your tasks. Be sure to setup your bucket by typing 'Setup'. ")

// Creates a get started button as a barrier to entry before you message the bot. It also checks if you have setup the bucket config
// information yet. This is done later on by calling a certain command. You can also modify it so it is hardwired with your bucket
// information.
bot.setGetStartedButton((payload, chat) => {
  if(config.bucket === undefined){
    chat.say('Hello my name is Note Buddy and I can help you keep track of your thoughts')
    chat.say("It seems like you have not setup your bucket settings yet. That has to be done before you can do anything else. Make sure to type 'setup'")
  }
  BotUserId = payload.sender.id
});

// This initiates a function that listens for specific keywords. Here we are listening for 'setup' but it can be changed to be
// anything. It can even accept regex statements
bot.hear('setup', (payload, chat) => {
  // Creates a function that can be called later to start the chain
  const getBucketSlug = (convo) => {
    convo.ask("What's your Bucket's slug?", (payload, convo) => {
      var slug = payload.message.text;
      // Takes what you send as an answer and sets that to a slug value that can be called in this instance of the conversation.
      // If you started another conversation later in a separate instance this value would not be remembered.
      convo.set('slug', slug)
      convo.say("setting slug as "+slug).then(() => getBucketReadKey(convo));
    })
  }
  const getBucketReadKey = (convo) => {
    convo.ask("What's your Bucket's read key?", (payload, convo) => {
      var readkey = payload.message.text;
      convo.set('read_key', readkey)
      convo.say('setting read_key as '+readkey).then(() => getBucketWriteKey(convo))
    })
  }
  const getBucketWriteKey = (convo) => {
    convo.ask("What's your Bucket's write key?", (payload, convo) => {
      var writekey = payload.message.text
      convo.set('write_key', writekey)
      convo.say('setting write_key as '+writekey).then(() => finishing(convo))
    })
  }
  const finishing = (convo) => {
    var newConfigInfo = {
      slug: convo.get('slug'),
      read_key: convo.get('read_key'),
      write_key: convo.get('write_key')
    }
    // Now we are starting to fisnish up the setup process with our final touches. First thing we have to do is get all of the
    // information together. Right here we are grabbing all of the info by calling 'convo.get'. Then we add it to the config
    // object declared earlier.
    config.bucket = newConfigInfo
    convo.say('All set :)')
    convo.end();
  }

  chat.conversation((convo) => {
    getBucketSlug(convo) // This is where everything starts. We start the conversation and start passing the convo value around.
  })
})

// Utilize the 'bot.hear' method and be friendly to the user
bot.hear(['hello', 'hey', 'sup'], (payload, chat)=>{
  chat.getUserProfile().then((user) => {
    chat.say(`Hey ${user.first_name}, How are you today?`)
  })
})

bot.hear('config', (payload, chat) => {
  if(JSON.stringify(config.bucket) === undefined){
    chat.say("No config found :/ Be sure to run 'setup' to add your bucket details")
  }
  chat.say("A config has been found :) "+ JSON.stringify(config.bucket))
})

bot.hear('create', (payload, chat) => {
  chat.conversation((convo) => {
    // Inside of the conversation we ask the user a question and wait for the reply
    convo.ask("What would you like your reminder to be? etc 'I have an appointment tomorrow from 10 to 11 AM' the information will be added automatically", (payload, convo) => {
      datetime = chrono.parseDate(payload.message.text) // Take what the user said and parse it using Chrono, a natural date parsing package
      var params = {
        write_key: config.bucket.write_key,
        type_slug: 'reminders',
        title: payload.message.text,
        metafields: [
         {
           key: 'date',
           type: 'text',
           value: datetime
         }
        ]
      } // We build the params object to be used with the CosmicJS Object addition
      Cosmic.addObject(config, params, function(error, response){ // We take the CosmicJS package and insert our new object using the params we created earlier
        if(!error){
          eventEmitter.emit('new', response.object.slug, datetime) // We are sending a NodeJS event emitter passing the slug from the return and the datetime we created earlier
          convo.say("reminder added correctly :)")
          convo.end()
        } else {
          convo.say("there seems to be a problem. . .")
          convo.end()
        }
      })
    })
  })
})

// Return a series of messages telling you what you can and can't do with the bot
bot.hear('help', (payload, chat) => {
  chat.say('Here are the following commands for use.')
  chat.say("'create': add a new reminder")
  chat.say("'setup': add your bucket info such as slug and write key")
  chat.say("'config': lists your current bucket config")
})

// Playing with event emitters
eventEmitter.on('new', function(itemSlug, time) {
  schedule.scheduleJob(time, function(){
    Cosmic.getObject(config, {slug: itemSlug}, function(error, response){
      if(response.object.metadata.date == new Date(time).toISOString()){
        bot.say(BotUserId, response.object.title)
        console.log('firing reminder')
      } else {
        eventEmitter.emit('new', response.object.slug, response.object.metafield.date.value)
        console.log('times do not match checking again at '+response.object.metadata.date)
      }
    })
  })
})

bot.start()
