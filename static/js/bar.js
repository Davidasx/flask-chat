(function () {
    function setExpanded(dropdown, expanded) {
        const button = dropdown.querySelector(".dropbtn");
        if (button) {
            button.setAttribute("aria-expanded", expanded ? "true" : "false");
        }
    }

    function closeAll() {
        document.querySelectorAll(".dropdown.open").forEach((dropdown) => {
            dropdown.classList.remove("open");
            setExpanded(dropdown, false);
        });
    }

    document.addEventListener("click", function (event) {
        const button = event.target.closest(".dropbtn");
        if (button) {
            const dropdown = button.closest(".dropdown");
            if (!dropdown) {
                return;
            }

            const isOpen = dropdown.classList.contains("open");
            closeAll();

            if (!isOpen) {
                dropdown.classList.add("open");
                setExpanded(dropdown, true);
            }
            return;
        }

        if (!event.target.closest(".dropdown")) {
            closeAll();
        }
    });

    document.addEventListener("keydown", function (event) {
        if (event.key === "Escape") {
            closeAll();
        }
    });
})();
