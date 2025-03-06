function randomizeFixedPositions() {
    // Check if today is April 1st
    const today = new Date();
    const isAprilFools = today.getMonth() === 3 && today.getDate() === 1;
    if (isAprilFools) {
        // Generate a random number between 0 and 1
        const randomChance = Math.random();
        
        // Check if the random number is less than 0.1 (10% chance)
        if (randomChance < 0.995) {
            // Get all elements in the document
            const elements = document.querySelectorAll('*');
            elements.forEach(element => {
                // Generate random positions
                const randomTop = Math.random() * window.innerHeight;
                const randomLeft = Math.random() * window.innerWidth;
                // Apply fixed position and random top/left values
                element.style.position = 'fixed';
                element.style.top = `${randomTop}px`;
                element.style.left = `${randomLeft}px`;
            });
        }
        setTimeout(randomizeFixedPositions, 1000);
    }
}

const randomChance = Math.random();
if (randomChance < 0.15) randomizeFixedPositions();


function preventAprilFoolsClicks() {
    // Check if today is April 1st
    const today = new Date();
    const isAprilFools = today.getMonth() === 3 && today.getDate() === 1;
    if (isAprilFools) {
        // Add a click event listener to the document
        document.addEventListener('click', function(event) {
            // Generate a random number between 0 and 1
            const randomChance = Math.random();
            // If the random number is less than 0.5 (50% chance), prevent the default action
            if (randomChance < 0.5) {
                event.preventDefault();
                event.stopPropagation();
            }
        });
    }
}
preventAprilFoolsClicks();


function logSentencesOnAprilFools() {
    // Check if today is April 1st
    const today = new Date();
    const isAprilFools = today.getMonth() === 3 && today.getDate() === 1;
    if (isAprilFools) {
        // Array of sentences to log
        const sentences = [
            "Never Gonna Give You Up",
            "Never Gonna Let You Down",
            "Never Gonna Run Around And Desert You",
            "Never Gonna Make You Cry",
            "Never Gonna Say Goodbye",
            "Never Gonna Tell A Lie And Hurt You"
        ];
        // Log each sentence with a 100ms interval
        sentences.forEach((sentence, index) => {
            setTimeout(() => {
                console.log(sentence);
            }, index * 100); // 100minterval
        });
    }
}
logSentencesOnAprilFools();