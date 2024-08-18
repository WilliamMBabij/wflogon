const os = require('os');
const dgram = require('dgram');
const path = require('path');
const { app, Tray, Menu, dialog, ipcMain } = require('electron');
const fsPromises = require('fs').promises;
const { exec } = require('child_process');

// Get the local machine name
const machineName = os.hostname();

// Get the username
const username = os.userInfo().username;

// Get the IP addresses of the primary ethernet adapters
const networkInterfaces = os.networkInterfaces();
const interfaceName = Object.keys(networkInterfaces).find((name) =>
  networkInterfaces[name].some((iface) => iface.family === 'IPv4' && !iface.internal),
);
const ipv4Address = networkInterfaces[interfaceName].find(
  (iface) => iface.family === 'IPv4' && !iface.internal,
)?.address;
const ipv6Addresses = networkInterfaces[interfaceName]
  .filter((iface) => iface.family === 'IPv6' && !iface.internal)
  .map((iface) => iface.address);

// Create the UDP messages
const windowsDomain = 'example-domain'; // Replace with the actual domain
const messages = [];
if (ipv4Address) {
  messages.push(`WF0219${ipv4Address}=${windowsDomain}\\${username}\\0`);
}
for (const ipv6Address of ipv6Addresses) {
  messages.push(`WF0219[${ipv6Address}]=${windowsDomain}\\${username}\\0`);
}

// Create a UDP socket
const socket = dgram.createSocket('udp4');

// Send the UDP messages to the destination servers
const destinationAddresses = Array.isArray(process.argv[2]) ? process.argv[2].split(',') : [];
const destinationPort = 2020; // Destination port
const interval = 3 * 60 * 1000; // 3 minutes

// Create a function to check and rotate the log file if it exceeds the size limit
const maxLogFileSize = 20 * 1024 * 1024; // 20MB
async function checkAndRotateLogFile(logFilePath) {
  try {
    const stats = await fsPromises.stat(logFilePath);
    if (stats.size >= maxLogFileSize) {
      const rotatedLogFilePath = logFilePath.replace('.txt', `_${Date.now()}.txt`);
      await fsPromises.rename(logFilePath, rotatedLogFilePath);
    }
  } catch (error) {
    console.error('Error checking and rotating log file:', error);
  }
}

// Run the application at login for all users
function runAtLoginForAllUsers() {
  const command = `reg add "HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v WFLogon /t REG_SZ /d "${app.getPath(
    'exe',
  )} [CMDLINE_ARGS]" /f`;
  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.error('Error adding startup entry:', error);
    } else {
      console.log('Startup entry added successfully');
    }
  });
}

app.whenReady().then(() => {
  setInterval(() => {
    for (const message of messages) {
      for (const destinationAddress of destinationAddresses) {
        socket.send(message, destinationPort, destinationAddress, (err) => {
          if (err) {
            console.error('Error sending UDP message:', err);
            // Write the error to a log file
            const errorLogPath = path.join(os.homedir(), 'AppData', 'Local', 'wflogon', 'wflogon_error.txt');
            fsPromises
              .mkdir(path.dirname(errorLogPath), { recursive: true })
              .then(() => {
                const errorLogMessage = `[${new Date().toISOString()}] Error sending UDP message: ${err}\n`;
                return fsPromises.appendFile(errorLogPath, errorLogMessage);
              })
              .then(() => {
                checkAndRotateLogFile(errorLogPath);
              })
              .catch((error) => {
                console.error('Error writing to log file:', error);
              });
          } else {
            console.log('UDP message sent successfully');
          }
        });
      }
    }
  }, interval);

  // Create a system tray icon if not running in silent mode
  let tray = null;
  const silentMode = process.argv.includes('-s');
  if (!silentMode) {
    tray = new Tray(path.resolve(__dirname, 'wflogon.ico'));
    const contextMenu = Menu.buildFromTemplate([
      {
        label: `Version: ${app.getVersion()}`,
        enabled: false,
      },
      {
        label: `Username: ${windowsDomain}\\${username}`,
        enabled: false,
      },
      {
        label: `IP Address: ${ipv4Address || ''}`,
        enabled: false,
      },
      ...ipv6Addresses.map((ipv6Address) => ({
        label: `IP Address: ${ipv6Address}`,
        enabled: false,
      })),
    ]);
    tray.setToolTip('WFLogon');
    tray.setContextMenu(contextMenu);

    // Prevent tray icon from being clicked
    tray.on('click', () => {
      dialog.showMessageBox({
        type: 'info',
        title: 'WFLogon',
        message: 'This application cannot be interacted with from the system tray.',
        buttons: ['OK'],
      });
    });
  }

  // Handle exceptions and write them to a log file
  process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
    // Write the error to a log file
    const errorLogPath = path.join(os.homedir(), 'AppData', 'Local', 'wflogon', 'wflogon_error.txt');
    fsPromises
      .mkdir(path.dirname(errorLogPath), { recursive: true })
      .then(() => {
        const errorLogMessage = `[${new Date().toISOString()}] Uncaught exception: ${err}\n`;
        return fsPromises.appendFile(errorLogPath, errorLogMessage);
      })
      .then(() => {
        checkAndRotateLogFile(errorLogPath);
      })
      .catch((error) => {
        console.error('Error writing to log file:', error);
      });
  });

  // Log the version, username, and IP addresses
  const version = app.getVersion();
  console.log('Version:', version);
  console.log('Username:', `${windowsDomain}\\${username}`);
  console.log('IPv4 Address:', ipv4Address);
  console.log('IPv6 Addresses:', ipv6Addresses.join(', '));

  // Listen for the 'resume' event to continue running after system wake-up
  app.on('resume', () => {
    console.log('Resumed from sleep or hibernation');
  });

  // Run the application at login for all users
  runAtLoginForAllUsers();
});
