import React from 'react';
import { View, StyleSheet, Text } from 'react-native';
import { WebView } from 'react-native-webview';

export default function TestWebView() {
  const simpleHTML = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body {
          margin: 0;
          padding: 20px;
          background-color: #f0f0f0;
          font-family: Arial, sans-serif;
        }
        .test {
          background-color: #4CAF50;
          color: white;
          padding: 20px;
          border-radius: 10px;
          text-align: center;
        }
      </style>
    </head>
    <body>
      <div class="test">
        <h1>WebView is Working!</h1>
        <p>If you can see this green box, WebView is functioning correctly.</p>
        <button onclick="sendMessage()">Test Communication</button>
      </div>
      <script>
        function sendMessage() {
          if (window.ReactNativeWebView) {
            window.ReactNativeWebView.postMessage('Hello from WebView!');
            alert('Message sent to React Native!');
          } else {
            alert('ReactNativeWebView not available');
          }
        }
      </script>
    </body>
    </html>
  `;

  return (
    <View style={styles.container}>
      <Text style={styles.header}>WebView Test</Text>
      <WebView
        source={{ html: simpleHTML }}
        style={styles.webView}
        onMessage={(event) => {
          console.log('Message from WebView:', event.nativeEvent.data);
          alert('Received: ' + event.nativeEvent.data);
        }}
        javaScriptEnabled={true}
        domStorageEnabled={true}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  header: {
    padding: 20,
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'center',
    backgroundColor: '#f5f5f5',
  },
  webView: {
    flex: 1,
  },
});