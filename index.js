var RC = require('ringcentral')
var fs = require('fs')
require('dotenv').load()
var async = require("async");

var rcsdk = null
if (process.env.MODE == "production"){
  rcsdk = new RC({
    server:RC.server.production,
    appKey: process.env.CLIENT_ID_PROD,
    appSecret:process.env.CLIENT_SECRET_PROD
  })
}else{
  rcsdk = new RC({
      server:RC.server.sandbox,
      appKey: process.env.CLIENT_ID_SB,
      appSecret:process.env.CLIENT_SECRET_SB
    })
}
var platform = rcsdk.platform()
var subscription = rcsdk.createSubscription()
subscription.on(subscription.events.notification, presenceEvent)

var usersList = []

login()

function login(){
  var un = ""
  var pwd = ""
  if (process.env.MODE == "production"){
    un= process.env.USERNAME_PROD,
    pwd= process.env.PASSWORD_PROD
  }else{
    un= process.env.USERNAME_SB,
    pwd= process.env.PASSWORD_SB
  }
  platform.login({
    username:un,
    password:pwd
  })
  .then(function(resp){
    checkExistingSubscription()
  })
  .catch(function(e){
    console.log(e)
    throw e
  })
}

function checkExistingSubscription(){
  fs.readFile('subscriptionId.txt', 'utf8', function (err, id) {
    if (err) {
      subscribeForNotification()
    }else{
      removeRegisteredSubscription(id)
    }
  });
}

function removeRegisteredSubscription(id) {
  platform.delete('/subscription/' + id)
    .then(function (response) {
      console.log("deleted: " + id)
      subscribeForNotification()
    })
    .catch(function(e) {
      console.error(e.toString());
      subscribeForNotification()
    });
}

function subscribeForNotification(){
  var eventFilter = ['/restapi/v1.0/account/~/presence']
  subscription.setEventFilters(eventFilter)
   .register()
   .then(function(resp){
     console.log('Ready for getting account presense events')
     var json = resp.json();
     fs.writeFile("subscriptionId.txt", json.id, function(err) {
     if(err)
       console.log(err);
     else
       console.log("SubscriptionId " + json.id + " is saved.");
     });
   })
   .catch(function(e){
     throw e
   })
}

function presenceEvent(msg){
  var user = {}
  user['extensionId'] = msg.body.extensionId
  user['telephonyStatus'] = msg.body.telephonyStatus
  user['startTime'] = ""
  checkTelephonyStatusChange(user)
}

function checkTelephonyStatusChange(user){
  var newUser = true
  for (var i=0; i<usersList.length; i++){
    if (usersList[i].extensionId == user.extensionId){
      console.log("OLD -> NEW: " + usersList[i].telephonyStatus + " -> " + user.telephonyStatus)
      newUser = false
      if (usersList[i].telephonyStatus == "NoCall" && user.telephonyStatus == "Ringing"){
        usersList[i].telephonyStatus = user.telephonyStatus
        usersList[i].startTime = createStartTime()
        console.log("ExtensionId " + usersList[i].extensionId + " has an incoming call")
        break
      }
      if (usersList[i].telephonyStatus == "Ringing" && user.telephonyStatus == "CallConnected"){
        usersList[i].telephonyStatus = user.telephonyStatus
        console.log("ExtensionId " + usersList[i].extensionId + " has a accepted a call")
        break
      }
      if (usersList[i].telephonyStatus == "Ringing" && user.telephonyStatus == "NoCall"){
        usersList[i].telephonyStatus = user.telephonyStatus
        console.log("ExtensionId " + usersList[i].extensionId + " has a missed call")
        break
      }
      if (usersList[i].telephonyStatus == "CallConnected" && user.telephonyStatus == "NoCall"){
        usersList[i].telephonyStatus = user.telephonyStatus
        var date = new Date()
        var stopTime = date.toISOString()
        stopTime = stopTime.replace('/', ':')
        console.log("ExtensionId " + usersList[i].extensionId + " has a terminated call")
        // wait for 20 secs then check for call recordings
        setTimeout(function(){
          readExtensionCallLogs(usersList[i].extensionId, usersList[i].startTime, stopTime)
        }, 20000)
        break
      }
    }
  }
  if (newUser){
    console.log("NEW USER: " + " -> " + user.telephonyStatus)
    if (user.telephonyStatus == "Ringing"){
      user.startTime = createStartTime()
      console.log("ExtensionId " + user.extensionId + " has an incoming call")
    }
    usersList.push(user)
  }
}

function createStartTime(){
  var date = new Date()
  var time = date.getTime()
  // make 10 secs to offset some delay in response
  var lessXXSeconds = time - 10000
  var from = new Date(lessXXSeconds)
  var dateFrom = from.toISOString()
  return dateFrom.replace('/', ':')
}

function readExtensionCallLogs(extensionId, startTime, stopTime){
  var endpoint = '/account/~/extension/'+ extensionId +'/call-log'
  var params = {}
  params['dateFrom'] = startTime
  params['dateTo'] = stopTime
  params['recordingType'] = 'All'

  platform.get(endpoint, params)
  .then(function(resp){
    async.each(resp.json().records,
      function(record, callback){
        console.log("THIS CALL HAS A RECORDING: " + record.recording.contentUri)
        saveAudioFile(record)
      },
      function(err){
        console.log("No call with call recording within this period of time.")
      }
    );
  })
  .catch(function(e){
    var err = e.toString();
    console.log(err)
  })
}


function saveAudioFile(record){
  platform.get(record.recording.contentUri)
  .then(function(res) {
    return res.response().buffer();
  })
  .then(function(buffer) {
    var destFile = './recordings/' + record.recording.id + '.mp3'
    fs.writeFileSync(destFile, buffer);
    console.log("CALL RECORDING SAVED AT: " + destFile)
  })
  .catch(function(e){
    console.log(e)
  })
}
