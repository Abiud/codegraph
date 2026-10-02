import marimo

__generated_with = "0.25.0"
app = marimo.App(width="medium")


@app.cell
def _():
    import marimo as mo

    import labkit as lk

    return lk, mo


@app.cell
def _(lk):
    fit = lk.fit_model([[1, 2]], "~ group")
    return (fit,)


@app.cell
def _(fit, lk, mo):
    lk.volcano(fit["counts"])
    mo.md("Done")
    return


if __name__ == "__main__":
    app.run()
