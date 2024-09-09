const { spawn } = require('child_process');

const runScript = () => {
    const process = spawn('node', ['index.js'], { stdio: 'inherit' });

    process.on('exit', (code) => {
        if (code === 1) {
            console.log(`Script exited with an unhandled error (code ${code}). Restarting...`);
            setTimeout(runScript, 1000); // Delay before restarting
        } else {
            console.log(`Script exited with code ${code}. No restart.`);
        }
    });

    process.on('error', (err) => {
        console.error('Error occurred:', err);
        // Handle any additional error logic here if needed
    });
};

// Start the script
runScript();