const removeButton = document.getElementById('removeMetaDataButton');
const chooseFileButton = document.getElementById('chooseFileButton');
const chooseOutputButton = document.getElementById('chooseOutputButton');
const inputInfo = document.getElementById('inputInfo');
const outputInfo = document.getElementById('outputInfo');
const outputFileNameInput = document.getElementById('outputFileName');

let selectedFilePath = null;
let selectedOutputFolderPath = null;

function clearInputFields() {
    selectedFilePath = null;
    selectedOutputFolderPath = null;
    inputInfo.textContent = 'no file selected';
    outputInfo.textContent = 'no output folder selected';
    outputFileNameInput.value = '';
}


chooseFileButton.addEventListener('click', async () => {
    const filePath = await window.electronAPI.selectFile();

    if (!filePath) {
        inputInfo.textContent = 'No file selected';
        selectedFilePath = null;
        return;
    }

    selectedFilePath = filePath;
    inputInfo.textContent = `Selected file: ${selectedFilePath}`;
});


chooseOutputButton.addEventListener('click', async () => {
    const outputFolderPath = await window.electronAPI.SelectOutputFolder();

    if (!outputFolderPath) {
        outputInfo.textContent = 'No output folder selected';
        return;
    }

    selectedOutputFolderPath = outputFolderPath;
    outputInfo.textContent = `Selected output folder: ${outputFolderPath}`;

});


removeButton.addEventListener('click', async () => {
    const outputFileName = outputFileNameInput.value.trim();

    if (!selectedFilePath) {
        alert('Please select a file first.');
        return;
    }

    const result = await window.electronAPI.removeMetaData(selectedFilePath, selectedOutputFolderPath, outputFileName);
    console.log('Result:', result);

    if (result.success) {
        showAlert(
            "Success",
            "Metadata removed successfully.",
            "success"
        );

        clearInputFields();
    } else {
        showAlert(
            "Something went wrong",
            `Failed to remove metadata: ${result.error}`,
            "error"
        );
    }
});


function showAlert(title, message, type = "success") {
    const overlay = document.getElementById("alertOverlay");
    const titleElement = document.getElementById("alertTitle");
    const messageElement = document.getElementById("alertMessage");
    const iconElement = document.getElementById("alertIcon");

    titleElement.textContent = title;
    messageElement.textContent = message;

    if (type === "error") {
        iconElement.textContent = "×";
        iconElement.classList.add("error");
    } else {
        iconElement.textContent = "✓";
        iconElement.classList.remove("error");
    }

    overlay.classList.add("show");
}

function closeAlert() {
    document
        .getElementById("alertOverlay")
        .classList.remove("show");
}

document
    .getElementById("alertCloseButton")
    .addEventListener("click", closeAlert);

document
    .getElementById("alertOverlay")
    .addEventListener("click", (event) => {
        if (event.target.id === "alertOverlay") {
            closeAlert();
        }
    });