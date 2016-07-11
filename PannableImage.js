import React, { Component, PropTypes } from 'react';
import {
  Dimensions,
  PanResponder,
  View,
  Animated,
  Easing,
  StyleSheet,
} from 'react-native';
import { distance, angle } from './utilities';
const { width, height } = Dimensions.get('window');

export class PannableImage extends Component {
  static propTypes = {
    imageHeight: PropTypes.number.isRequired,
    imageWidth: PropTypes.number.isRequired,
    imageContainerHeight: PropTypes.number,
    imageContainerWidth: PropTypes.number,
    imageMask: PropTypes.any,
    maskHeight: PropTypes.number,
    maskWidth: PropTypes.number,
    maskPadding: PropTypes.number,
    children: PropTypes.any,
  }

  static defaultProps = {
    maskWidth: width,
    maskHeight: height,
    maskPadding: 0,
    imageContainerWidth: width,
    imageContainerHeight: height,
  }

  constructor(props, context) {
    super(props, context);
    this.state = {
      size: new Animated.ValueXY({
        x: props.imageWidth,
        y: props.imageHeight,
      }),
      pan: new Animated.ValueXY(),
      angle: new Animated.Value('0deg'),
      animating: false,
    };
    this._panResponder = {};
    this.panListener = null;
    this.currentPanValue = { x: 0, y: 0 };
    this.sizeListener = null;
    this.currentSizeValue = { x: props.imageWidth, y: props.imageHeight };
    this.angleListener = null;
    this.currentAngleValue = 0;
    this._imageWidth = props.imageWidth;
    this._imageHeight = props.imageHeight;
    this._angle = 0;
    this._previousDistance = 0;
    this._previousAngle = 0;
    this._multiTouch = false;
    this._handlePanResponderMove = ::this._handlePanResponderMove;
    this._handlePanResponderEnd = ::this._handlePanResponderEnd;
    this._updatePosition = ::this._updatePosition;
    this._updateSize = ::this._updateSize;
    this._checkAdjustment = ::this._checkAdjustment;
    this._updatePanState = ::this._updatePanState;
  }

  componentWillMount() {
    this._panResponder = PanResponder.create({
      onStartShouldSetPanResponder: () => !this.state.animating,
      onMoveShouldSetPanResponder: () => !this.state.animating,
      onPanResponderMove: this._handlePanResponderMove,
      onPanResponderRelease: this._handlePanResponderEnd,
      onPanResponderTerminate: this._handlePanResponderEnd,
    });
  }

  componentDidMount() {
    this.panListener = this.state.pan.addListener((value) => this.currentPanValue = value);
    this.sizeListener = this.state.size.addListener((value) => this.currentSizeValue = value);
    this.angleListener = this.state.angle.addListener((value) => this.currentAngleValue = value);
  }

  componentWillUnmount() {
    this.state.pan.removeListener(this.panListener);
    this.state.size.removeListener(this.sizeListener);
    this.state.angle.removeListener(this.angleListener);
  }

  _updatePosition(x, y) {
    this.setState({ animating: true });
    Animated.timing(
      this.state.pan, {
        toValue: { x, y },
        easing: Easing.elastic(1),
        duration: 250
      }
    ).start(() => this._updatePanState());
  }

  _updateSize(x, y) {
    this.setState({ animating: true });
    Animated.timing(
      this.state.size, {
        toValue: { x, y },
        easing: Easing.elastic(1),
        duration: 250
      }
    ).start(() => {
      this.setState({ animating: false });
      this._imageWidth = this.currentSizeValue.x;
      this._imageHeight = this.currentSizeValue.y;
      this._checkAdjustment();
    });
  }

  _updatePanState(x = this.currentPanValue.x, y = this.currentPanValue.y) {
    this.state.pan.setOffset({ x, y });
    this.state.pan.setValue({ x: 0, y: 0 });
    this.setState({ animating: false });
  }

  _handlePanResponderMove(e, gestureState) {
    if (gestureState.numberActiveTouches === 1 && !this._multiTouch) {
      const move = Animated.event([
        null, { dx: this.state.pan.x, dy: this.state.pan.y }
      ]);
      return move(e, gestureState);
    } else if (gestureState.numberActiveTouches !== 1) {
      this._multiTouch = true;
      this._previousDistance = this._previousDistance === 0 ?
        distance(e.nativeEvent.touches) : this._previousDistance;
      this._previousAngle = this._previousAngle === 0 ?
        angle(e.nativeEvent.touches) : this._previousAngle;
      // angle calculations
      const angleChange = angle(e.nativeEvent.touches) - this._previousAngle;
      this.state.angle.setValue(
        `${parseFloat(this._angle) + angleChange}deg`
      );
      // zoom calculations
      const currentDistance = distance(e.nativeEvent.touches);
      const newHeight = currentDistance - this._previousDistance + this._imageHeight;
      const newWidth = this._imageWidth * (newHeight / this._imageHeight);
      this.state.size.setValue({ x: newWidth, y: newHeight });
    }
    return null;
  }

  _handlePanResponderEnd() {
    this._updatePanState();
    if (this._multiTouch) {
      this._imageWidth = this.currentSizeValue.x;
      this._imageHeight = this.currentSizeValue.y;
      this._angle = this.currentAngleValue.value;
      this._multiTouch = false;
      this._previousDistance = 0;
      this._previousAngle = 0;
      const { maskWidth, maskHeight } = this.props;
      if (this._imageWidth < maskWidth || this._imageHeight < maskHeight) {
        const newWidth = this._imageWidth < maskWidth ? maskWidth : this._imageWidth;
        const newHeight = this._imageHeight < maskHeight ? maskHeight : this._imageHeight;
        this._updateSize(newWidth, newHeight);
      } else {
        this._checkAdjustment();
      }
    } else {
      this._checkAdjustment();
    }
  }

  _checkAdjustment() {
    const positionUpdate = { x: 0, y: 0 };
    const imageAbove = this.currentPanValue.y + this._imageHeight -
      this.props.imageContainerHeight + this.props.maskPadding;
    const imageLeft = this.currentPanValue.x + this._imageWidth -
      this.props.imageContainerWidth + this.props.maskPadding;
    if (this.currentPanValue.x > this.props.maskPadding) {
      positionUpdate.x = -this.currentPanValue.x + this.props.maskPadding;
    }
    if (this.currentPanValue.y > this.props.maskPadding) {
      positionUpdate.y = -this.currentPanValue.y + this.props.maskPadding;
    }
    if (imageAbove < 0) {
      positionUpdate.y = -imageAbove;
    }
    if (imageLeft < 0) {
      positionUpdate.x = -imageLeft;
    }
    this._updatePosition(positionUpdate.x, positionUpdate.y);
  }

  render() {
    const { pan, size } = this.state;
    const {
      imageContainerWidth,
      imageContainerHeight,
      imageMask,
      children,
    } = this.props;
    const layout = pan.getLayout();
    return (
      <View
        style={[
          styles.container,
          { width: imageContainerWidth, height: imageContainerHeight }
        ]}
        {...this._panResponder.panHandlers}
      >
        <Animated.View
          style={{
            width: size.x,
            height: size.y,
            transform: [
              { translateX: layout.left },
              { translateY: layout.top },
              { rotate: this.state.angle }
            ]
          }}
        >
          {React.cloneElement(
            React.Children.only(children), {
              imageWidth: size.x,
              imageHeight: size.y,
            }
          )}
        </Animated.View>
        {imageMask && React.createElement(imageMask)}
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
  },
});
