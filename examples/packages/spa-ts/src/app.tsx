import React, { Component } from 'react';
import { NameComponent, ImageTestComponent } from 'example-browser-ts-react';

export class Counter extends Component<{}, { value: number }> {
  state = {
    value: 0
  };

  intervalId: number | null = null;

  componentDidMount() {
    this.intervalId = setInterval(
      () => this.setState(({ value }) => ({ value: value + 1 })),
      1000
    );
  }

  componentWillUnmount() {
    clearInterval(this.intervalId);
  }

  render() {
    return <p>Value is: {this.state.value * 100}</p>;
  }
}

/**
 * This is our app component.
 */
export const AppComponent = () => (
  <div>
    <Counter />
    <NameComponent a={1} b={2} name="_otbe_" />
    <ImageTestComponent />
    {process.env.NODE_ENV === 'production' ? (
      <p>Production Build</p>
    ) : (
      <p>Dev Build</p>
    )}
  </div>
);
