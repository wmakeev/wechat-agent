function init () {
  'use strict'

  /* global $, AWS, EventEmitter, Simulate */

  function loadScript (src, globalName) {
    return new Promise(function (resolve, reject) {
      if (globalName && window[globalName]) { return resolve() }

      let head = document.head || document.getElementsByTagName('head')[0]
      let script = document.createElement('script')

      script.type = 'text/javascript'
      script.charset = 'utf8'
      script.async = true
      script.src = src

      script.onload = function () {
        this.onerror = this.onload = null
        console.debug('load-script: [' + (globalName || src) + '] injected')
        resolve()
      }

      script.onerror = function () {
        // this.onload = null here is necessary
        // because even IE9 works not like others
        this.onerror = this.onload = null
        reject(new Error('Failed to load ' + this.src))
      }

      head.appendChild(script)
    })
  }

  function spawnNotification ({ body, icon, title }) {
    let options = { body, icon }
    return new Notification(title, options)
  }

  function getUserName () {
    return $('span.display_name').text()
  }

  function sendMessage ({ msg, userName }) {
    // Select chats list
    let $usersList = $('#J_NavChatScrollBody.chat_list')
      .find('>div>div.ng-scope>div')

    if ($usersList.length === 0) {
      throw new Error('Can\'t find chats list. May be WeChat logged out.')
    }

    // Select chat
    let $chatEl = $usersList.filter(function () {
      return $(`h3:contains('${userName}')`, this).length === 1
    })

    if ($chatEl.length > 1) {
      throw new Error(`Several chats found for "${userName}" user name`)
    } else if ($chatEl.length === 0) {
      throw new Error(`Can't find chat for user name "${userName}"`)
    }

    Simulate.click($chatEl.get(0))

    // TODO Проверить что выбраный чат активен

    // Type message
    let $editArea = $('#editArea').html(msg)
    Simulate.input($editArea.get(0))

    // Send message
    let sendButtonEl = $('.btn.btn_send').get(0)
    Simulate.click(sendButtonEl)

    // TODO Проверить что сообщение отправлено
  }

  let startAgent = taistApi => ([accessKeyId, secretAccessKey, queueUrl, region]) => {
    let started = false
    let emitter = new EventEmitter()

    AWS.config.region = region
    AWS.config.update({ accessKeyId, secretAccessKey })

    let sqs = new AWS.SQS()

    let params = {
      QueueUrl: queueUrl,
      MaxNumberOfMessages: 1,
      VisibilityTimeout: 20,
      WaitTimeSeconds: 20
    }

    emitter.on('receive', () => {
      if (!started) { return }

      sqs.receiveMessage(params, (err, data) => {
        if (err) {
          emitter.emit('error', err)
        } else if (data && data.Messages && data.Messages.length) {
          if (started) { emitter.emit('message', data.Messages[0]) }
        } else {
          emitter.emit('receive')
        }
      })
    })

    emitter.on('message', msg => {
      let body

      try {
        body = JSON.parse(msg.Body)
      } catch (e) {
        return emitter.emit('error', e)
      }

      // Try send message
      try {
        sendMessage(body)
        spawnNotification({
          title: 'WeChat agent',
          body: `Message is sent to "${body.userName}"`
        })
      } catch (e) {
        return emitter.emit('error', e)
      }

      sqs.deleteMessage({
        QueueUrl: queueUrl,
        ReceiptHandle: msg.ReceiptHandle
      }, (err /*, data */) => {
        if (err) {
          emitter.emit('error',
            new Error(`Message ${msg.MessageId} not deleted: ${err.message}`))
        } else {
          setTimeout(() => emitter.emit('receive'), 3000)
        }
      })
    })

    emitter.on('start', () => {
      started = true
      spawnNotification({ title: 'WeChat agent', body: 'started' })
      emitter.emit('receive')
    })

    emitter.on('stop', () => {
      started = false
      spawnNotification({ title: 'WeChat agent', body: 'stopped' })
    })

    emitter.on('error', err => {
      spawnNotification({
        title: 'WeChat agent',
        body: `Error: "${err.message}"`
      })
      emitter.emit('stop')
    })

    taistApi.wait.change(() => getUserName(), () => {
      if (getUserName() === '') {
        if (started) { emitter.emit('stop') }
      } else {
        if (!started) { emitter.emit('start') }
      }
    })
  }

  return {
    start (taistApi) {
      if (Notification && Notification.permission !== 'granted') {
        Notification.requestPermission()
      }

      window.setWeChatAgentVar = (name, value) => {
        taistApi.companyData.set(name, value, err => {
          if (err) { alert(err.message) } else { alert(`${name} is set`) }
        })
      }

      window.sendMessage = sendMessage

      let getCompanyData = key => new Promise((resolve, reject) =>
        taistApi.companyData.get(key, (err, data) => {
          if (err) { reject(err) } else { resolve(data) }
        }))

      let srcs = [
        'https://cdnjs.cloudflare.com/ajax/libs/aws-sdk/2.4.7/aws-sdk.min.js',
        'https://cdnjs.cloudflare.com/ajax/libs/EventEmitter/5.1.0/EventEmitter.js',
        'https://cdn.rawgit.com/airportyh/simulate.js/master/simulate.js'
        // 'https://wzrd.in/standalone/mutation-summary@0.0.0'
      ]

      Promise.all(srcs.map(loadScript))
        .then(() => {
          return Promise.all([
            'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY_ID', 'AWS_QUEUE_URL', 'AWS_REGION'
          ].map(getCompanyData))
        })

        .then(startAgent(taistApi))

        .catch(err => {
          spawnNotification({
            title: 'WeChat agent',
            body: `On start error: "${err.message}"`
          })
        })
    }
  }
}
